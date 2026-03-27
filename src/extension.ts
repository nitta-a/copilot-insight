import * as vscode from "vscode";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { EventTracker } from "./events/eventTracker";
import { InlineCompletionTracker } from "./events/inlineCompletionWrapper";
import { exportAsCsv, exportAsJson } from "./export/exportStats";
import { generateMarkdownReport } from "./export/reportGenerator";
import { parseCopilotLogs } from "./log/copilotLogParser";
import { getSortedSessionDirs } from "./log/logFileReader";
import { StatsSnapshotStorage } from "./log/statsSnapshotStorage";
import {
  computeModelPerformance,
  computeRefreshAnalysis,
  computeTrueAcceptanceRate,
  computeVelocityAnalysis,
} from "./metrics/metricsEngine";
import type { CopilotUsageStats } from "./types";
import { CopilotUsagePanel } from "./ui/copilotUsagePanel";
import { CopilotUsageTreeProvider } from "./ui/copilotUsageTreeProvider";
import { buildDashboardPayload } from "./ui/dashboardPayload";
import { StatusBarIndicator } from "./ui/statusBarIndicator";
import { todayDateString } from "./utils";
import { resolveLogSearchPaths } from "./utils/logPaths";
import type { DbWorkerClient } from "./worker/dbWorkerClient";
import { DbWorkerClientImpl } from "./worker/dbWorkerClient";
import { getLogChannel, isTimingLogsEnabled } from "./log/logChannel";

/** Number of most-recent session directories parsed on initial dashboard load. */
const INITIAL_SESSION_LIMIT = 5;

let cachedStats: CopilotUsageStats | undefined;

function isAdvancedAnalysisEnabled(): boolean {
  return vscode.workspace.getConfiguration("copilot-insight").get<boolean>("enableAdvancedAnalysis", true);
}

export function activate(context: vscode.ExtensionContext) {
  // Conditionally start the DB worker based on the master-toggle setting.
  const workerPath = path.join(context.extensionUri.fsPath, "dist", "worker", "dbWorker.js");
  let dbWorker: DbWorkerClient | undefined = isAdvancedAnalysisEnabled()
    ? new DbWorkerClientImpl(workerPath)
    : undefined;

  // Phase 1: Event instrumentation — capture text-change, editor-switch, and
  // completion-accept events and persist them to structured storage.
  const eventTracker = new EventTracker(context, dbWorker);

  // Install the inline-completion wrapper as early as possible so that any
  // provider registered after activation (including GitHub Copilot) is
  // intercepted and its show/accept events are counted in real-time.
  const inlineTracker = new InlineCompletionTracker(context, {
    onShown: async (metadata) => {
      await eventTracker.recordSessionSignal({
        languageId: metadata.languageId,
        signalType: "completion-shown",
        actor: "system",
        phase: "planning",
        intent: "inline-completion/shown",
        rawText: metadata.acceptedText || "inline completion shown",
        success: true,
      });
    },
    onAccepted: async (metadata) => {
      await eventTracker.recordCompletionAccept({
        languageId: metadata.languageId,
        acceptedText: metadata.acceptedText,
      });
      if (metadata.uri) {
        eventTracker.trackActiveCompletion(metadata.uri, metadata.lineNumber, metadata.languageId);
      }
    },
  });

  // Watch for runtime changes to the enableAdvancedAnalysis toggle.
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("copilot-insight.enableAdvancedAnalysis")) {
      if (!isAdvancedAnalysisEnabled() && dbWorker) {
        void dbWorker.close();
        dbWorker = undefined;
        eventTracker.setDbWorker(undefined);
      } else if (isAdvancedAnalysisEnabled() && !dbWorker) {
        dbWorker = new DbWorkerClientImpl(workerPath);
        eventTracker.setDbWorker(dbWorker);
      }
    }
  });

  // Phase 3: Real-time status bar indicator showing current-session
  // Copilot contribution (acceptance rate + counts).
  const statusBar = new StatusBarIndicator();
  const statsSnapshotStorage = new StatsSnapshotStorage(context.globalStorageUri.fsPath);

  // Periodically refresh the status bar from the inline tracker.
  const statusBarRefreshMs = 3_000;
  const statusBarTimer = setInterval(() => {
    statusBar.update(inlineTracker.stats);
  }, statusBarRefreshMs);

  const treeProvider = new CopilotUsageTreeProvider();

  const copilotUsageTreeView = vscode.window.createTreeView("copilotUsageView", {
    treeDataProvider: treeProvider,
  });

  void statsSnapshotStorage.read().then((stats) => {
    if (!stats) {
      return;
    }
    cachedStats = stats;
    treeProvider.updateStats(stats);
  });

  /** Parse logs, cache result, and update TreeView + Panel. */
  async function refreshStats(): Promise<CopilotUsageStats> {
    const stats = await parseCopilotLogs(context.logUri, { scanAllSessions: true });
    cachedStats = stats;
    treeProvider.updateStats(stats);
    await statsSnapshotStorage.write(stats);
    return stats;
  }

  /**
   * Perform a fast initial parse limited to the most recent sessions.
   * Returns the partial stats and a flag indicating whether older sessions
   * are available for deferred loading.
   *
   * Uses a single directory listing request: fetch one more than the limit so
   * we can detect whether more sessions exist without a full directory scan.
   */
  async function getInitialStats(): Promise<{ stats: CopilotUsageStats; hasMoreData: boolean }> {
    const { logBaseDir, fallbackSessionDir } = resolveLogSearchPaths(context.logUri.fsPath);
    // Fetch at most INITIAL_SESSION_LIMIT + 1 entries to determine whether more exist.
    const probe = await getSortedSessionDirs(logBaseDir, fallbackSessionDir, { limit: INITIAL_SESSION_LIMIT + 1 });
    const hasMoreData = probe.length > INITIAL_SESSION_LIMIT;
    const stats = await parseCopilotLogs(context.logUri, { limitSessions: INITIAL_SESSION_LIMIT });
    cachedStats = stats;
    treeProvider.updateStats(stats);
    await statsSnapshotStorage.write(stats);
    return { stats, hasMoreData };
  }

  async function ensureStatsLoaded(): Promise<CopilotUsageStats> {
    if (cachedStats) {
      return cachedStats;
    }
    const persistedStats = await statsSnapshotStorage.read();
    if (persistedStats) {
      cachedStats = persistedStats;
      treeProvider.updateStats(persistedStats);
      return persistedStats;
    }
    return refreshStats();
  }

  /** Compute advanced metrics (best-effort) from tracked events. */
  async function getAdvancedMetrics(stats: CopilotUsageStats) {
    const timingEnabled = isTimingLogsEnabled();
    const channel = getLogChannel();
    const advancedStartMs = performance.now();

    const logBaseDir = resolveLogSearchPaths(context.logUri.fsPath).logBaseDir;
    const dates = eventTracker.storage.listDates();
    const allEvents = dates.flatMap((d) => eventTracker.storage.readByDate(d));
    if (allEvents.length === 0) {
      if (timingEnabled) {
        channel.appendLine(
          `[TIMING] getAdvancedMetrics: skipped (no tracked events) | ${(performance.now() - advancedStartMs).toFixed(1)}ms`,
        );
      }
      return { logBaseDir };
    }
    if (dbWorker) {
      try {
        let phaseMs = performance.now();
        await dbWorker.loadFromJsonl(context.globalStorageUri.fsPath);
        if (timingEnabled) {
          channel.appendLine(`[TIMING] db.loadFromJsonl: ${(performance.now() - phaseMs).toFixed(1)}ms`);
        }

        phaseMs = performance.now();
        if (stats.sessionSignals.length > 0) {
          await dbWorker.ingest(stats.sessionSignals);
        }
        if (timingEnabled) {
          channel.appendLine(
            `[TIMING] db.ingest: ${(performance.now() - phaseMs).toFixed(1)}ms | ${stats.sessionSignals.length} signal(s)`,
          );
        }

        // NOTE: setChatSessionTitles / setChatSessions / getSessionList are
        // intentionally omitted here — chat session data is loaded lazily when
        // the Sessions tab is first opened (see CopilotUsagePanel._buildSessionsPayloadAsync).
        phaseMs = performance.now();
        const [trueAcceptance, velocity, modelPerformance, refreshAnalysis] = await Promise.all([
          dbWorker.trueRate(stats.totalShown),
          dbWorker.velocity(),
          dbWorker.modelPerformance(),
          dbWorker.getRefreshAnalysis({ memoryEvents: stats.memoryManagementEvents }),
        ]);
        if (timingEnabled) {
          channel.appendLine(
            `[TIMING] db.computeMetrics: ${(performance.now() - phaseMs).toFixed(1)}ms (trueRate+velocity+modelPerf+refreshAnalysis parallel)`,
          );
          channel.appendLine(
            `[TIMING] getAdvancedMetrics total: ${(performance.now() - advancedStartMs).toFixed(1)}ms [db path]`,
          );
        }
        return {
          trueAcceptance,
          velocity,
          modelPerformance,
          refreshAnalysis,
          logBaseDir,
        };
      } catch {
        // Fall back to in-process computation when the worker is unavailable.
      }
    }

    let phaseMs = performance.now();
    const trueAcceptance = computeTrueAcceptanceRate(allEvents, stats.totalShown);
    if (timingEnabled) {
      channel.appendLine(`[TIMING] fallback.trueRate: ${(performance.now() - phaseMs).toFixed(1)}ms`);
    }
    phaseMs = performance.now();
    const velocity = computeVelocityAnalysis(allEvents);
    if (timingEnabled) {
      channel.appendLine(`[TIMING] fallback.velocity: ${(performance.now() - phaseMs).toFixed(1)}ms`);
    }
    phaseMs = performance.now();
    const modelPerformance = computeModelPerformance(allEvents);
    if (timingEnabled) {
      channel.appendLine(`[TIMING] fallback.modelPerformance: ${(performance.now() - phaseMs).toFixed(1)}ms`);
    }
    phaseMs = performance.now();
    const refreshAnalysis = computeRefreshAnalysis(allEvents, stats.memoryManagementEvents);
    if (timingEnabled) {
      channel.appendLine(`[TIMING] fallback.refreshAnalysis: ${(performance.now() - phaseMs).toFixed(1)}ms`);
      channel.appendLine(
        `[TIMING] getAdvancedMetrics total: ${(performance.now() - advancedStartMs).toFixed(1)}ms [fallback path]`,
      );
    }
    return {
      trueAcceptance,
      velocity,
      modelPerformance,
      refreshAnalysis,
      logBaseDir,
    };
  }

  const showCopilotUsageDisposable = vscode.commands.registerCommand("copilot-insight.showCopilotUsage", async () => {
    if (!isAdvancedAnalysisEnabled()) {
      vscode.window.showInformationMessage(
        "Advanced analysis is disabled. Please enable it in settings to view metrics.",
      );
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Parsing GitHub Copilot logs...",
      },
      async () => {
        const timingEnabled = isTimingLogsEnabled();
        const channel = getLogChannel();

        let phaseMs = performance.now();
        const { stats, hasMoreData } = await getInitialStats();
        if (timingEnabled) {
          channel.appendLine(`[TIMING] getInitialStats: ${(performance.now() - phaseMs).toFixed(1)}ms`);
        }

        phaseMs = performance.now();
        const advanced = await getAdvancedMetrics(stats);
        if (timingEnabled) {
          channel.appendLine(`[TIMING] getAdvancedMetrics: ${(performance.now() - phaseMs).toFixed(1)}ms`);
        }

        const userPromptsDir = path.resolve(context.globalStorageUri.fsPath, "../../..", "prompts");
        const copilotMemoryDir = path.join(
          context.storageUri?.fsPath ?? "",
          "..",
          "GitHub.copilot-chat",
          "memory-tool",
          "memories",
        );
        phaseMs = performance.now();
        CopilotUsagePanel.createOrShow(
          context.extensionUri,
          stats,
          {
            ...advanced,
            logUri: context.logUri,
            hasMoreData,
            userPromptsDir,
            copilotMemoryDir,
            globalStoragePath: context.globalStorageUri.fsPath,
          },
          dbWorker,
        );
        if (timingEnabled) {
          // _update() is async fire-and-forget; this measures only the sync entry cost.
          channel.appendLine(`[TIMING] createOrShow (sync entry): ${(performance.now() - phaseMs).toFixed(1)}ms`);
        }
      },
    );
  });

  const refreshDisposable = vscode.commands.registerCommand("copilot-insight.refreshUsage", async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Refreshing Copilot usage data...",
      },
      async () => {
        const timingEnabled = isTimingLogsEnabled();
        const channel = getLogChannel();

        let phaseMs = performance.now();
        const stats = await refreshStats();
        if (timingEnabled) {
          channel.appendLine(`[TIMING] refreshStats: ${(performance.now() - phaseMs).toFixed(1)}ms`);
        }

        if (CopilotUsagePanel.currentPanel) {
          phaseMs = performance.now();
          const advanced = await getAdvancedMetrics(stats);
          if (timingEnabled) {
            channel.appendLine(`[TIMING] getAdvancedMetrics: ${(performance.now() - phaseMs).toFixed(1)}ms`);
          }

          const userPromptsDir = path.resolve(context.globalStorageUri.fsPath, "../../..", "prompts");
          const copilotMemoryDir = path.join(
            context.storageUri?.fsPath ?? "",
            "..",
            "GitHub.copilot-chat",
            "memory-tool",
            "memories",
          );
          phaseMs = performance.now();
          CopilotUsagePanel.createOrShow(
            context.extensionUri,
            stats,
            {
              ...advanced,
              logUri: context.logUri,
              hasMoreData: false,
              userPromptsDir,
              copilotMemoryDir,
              globalStoragePath: context.globalStorageUri.fsPath,
            },
            dbWorker,
          );
          if (timingEnabled) {
            channel.appendLine(`[TIMING] createOrShow (sync entry): ${(performance.now() - phaseMs).toFixed(1)}ms`);
          }
        }
      },
    );
  });

  const exportCsvDisposable = vscode.commands.registerCommand("copilot-insight.exportCsv", async () => {
    const stats = await ensureStatsLoaded();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder, `copilot-usage-${todayDateString()}.csv`)
        : vscode.Uri.file(`copilot-usage-${todayDateString()}.csv`),
      filters: { csv: ["csv"] },
    });
    if (uri) {
      const content = exportAsCsv(stats);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  });

  const exportJsonDisposable = vscode.commands.registerCommand("copilot-insight.exportJson", async () => {
    const stats = await ensureStatsLoaded();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder, `copilot-usage-${todayDateString()}.json`)
        : vscode.Uri.file(`copilot-usage-${todayDateString()}.json`),
      filters: { json: ["json"] },
    });
    if (uri) {
      const content = exportAsJson(stats);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  });

  // Phase 3: Export Markdown report with ROI estimation.
  const exportReportDisposable = vscode.commands.registerCommand("copilot-insight.exportReport", async () => {
    const stats = await ensureStatsLoaded();

    // Gather events for advanced metrics (best-effort).
    const dates = eventTracker.storage.listDates();
    const allEvents = dates.flatMap((d) => eventTracker.storage.readByDate(d));

    const trueAcceptance = allEvents.length > 0 ? computeTrueAcceptanceRate(allEvents, stats.totalShown) : undefined;
    const velocity = allEvents.length > 0 ? computeVelocityAnalysis(allEvents) : undefined;
    const modelPerformance = allEvents.length > 0 ? computeModelPerformance(allEvents) : undefined;

    const period = dates.length > 0 ? `${dates[0]} — ${dates[dates.length - 1]}` : "All available data";
    const projectName = vscode.workspace.name;

    // Build the dashboard payload to obtain consistent pre-computed ROI values and
    // auto-generated insights — this ensures the report numbers match the dashboard.
    const dashboardPayload = buildDashboardPayload(stats, trueAcceptance, velocity, modelPerformance);
    const { typingMinutesSaved, agenticMinutesSaved } = dashboardPayload.summary;
    const insights = dashboardPayload.insights;

    const content = generateMarkdownReport({
      period,
      projectName,
      stats,
      trueAcceptance,
      velocity,
      modelPerformance,
      insights,
      typingMinutesSaved,
      agenticMinutesSaved,
    });

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder, `copilot-usage-report-${todayDateString()}.md`)
        : vscode.Uri.file(`copilot-usage-report-${todayDateString()}.md`),
      filters: { markdown: ["md"] },
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`Report exported to ${uri.fsPath}`);
    }
  });

  context.subscriptions.push(
    treeProvider,
    copilotUsageTreeView,
    eventTracker,
    statusBar,
    configWatcher,
    { dispose: () => clearInterval(statusBarTimer) },
    showCopilotUsageDisposable,
    refreshDisposable,
    exportCsvDisposable,
    exportJsonDisposable,
    exportReportDisposable,
  );
}

export function deactivate() {}
