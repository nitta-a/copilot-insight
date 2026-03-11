import * as vscode from "vscode";
import * as path from "node:path";
import { EventTracker } from "./events/eventTracker";
import { InlineCompletionTracker } from "./events/inlineCompletionWrapper";
import { exportAsCsv, exportAsJson } from "./export/exportStats";
import { generateMarkdownReport } from "./export/reportGenerator";
import { parseCopilotLogs } from "./log/copilotLogParser";
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
import {
  buildDashboardPayload,
  ROI_AGENTIC_COGNITIVE_WEIGHT,
  ROI_AVG_CHARS_PER_COMPLETION,
  ROI_TYPING_SPEED_CPM,
} from "./ui/dashboardPayload";
import { StatusBarIndicator } from "./ui/statusBarIndicator";
import { todayDateString } from "./utils";
import type { DbWorkerClient } from "./worker/dbWorkerClient";
import { DbWorkerClientImpl } from "./worker/dbWorkerClient";

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
    const dates = eventTracker.storage.listDates();
    const allEvents = dates.flatMap((d) => eventTracker.storage.readByDate(d));
    if (allEvents.length === 0) {
      return {};
    }
    if (dbWorker) {
      try {
        await dbWorker.loadFromJsonl(context.globalStorageUri.fsPath);
        if (stats.sessionSignals.length > 0) {
          await dbWorker.ingest(stats.sessionSignals);
        }
        await dbWorker.setChatSessionTitles(stats.chatSessionTitles ?? []);
        await dbWorker.setChatSessions(stats.chatSessions ?? []);
        const [trueAcceptance, velocity, modelPerformance, refreshAnalysis, sessionSummaries] = await Promise.all([
          dbWorker.trueRate(stats.totalShown),
          dbWorker.velocity(),
          dbWorker.modelPerformance(),
          dbWorker.getRefreshAnalysis({ memoryEvents: stats.memoryManagementEvents }),
          dbWorker.getSessionList(),
        ]);
        return {
          trueAcceptance,
          velocity,
          modelPerformance,
          refreshAnalysis,
          sessionSummaries,
        };
      } catch {
        // Fall back to in-process computation when the worker is unavailable.
      }
    }
    return {
      trueAcceptance: computeTrueAcceptanceRate(allEvents, stats.totalShown),
      velocity: computeVelocityAnalysis(allEvents),
      modelPerformance: computeModelPerformance(allEvents),
      refreshAnalysis: computeRefreshAnalysis(allEvents, stats.memoryManagementEvents),
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
        const stats = await refreshStats();
        CopilotUsagePanel.createOrShow(context.extensionUri, stats);
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
        const stats = await refreshStats();
        if (CopilotUsagePanel.currentPanel) {
          CopilotUsagePanel.createOrShow(context.extensionUri, stats);
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
    const dashboardPayload = buildDashboardPayload(stats);
    const typingMinutesSaved = (stats.totalAccepted * ROI_AVG_CHARS_PER_COMPLETION) / ROI_TYPING_SPEED_CPM;
    const agenticMinutesSaved = (stats.autonomousDurationMs / 60000) * ROI_AGENTIC_COGNITIVE_WEIGHT;
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
