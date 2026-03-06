import * as vscode from "vscode";
import * as path from "node:path";
import { EventTracker } from "./events/eventTracker";
import { InlineCompletionTracker } from "./events/inlineCompletionWrapper";
import { exportAsCsv, exportAsJson } from "./export/exportStats";
import { generateMarkdownReport } from "./export/reportGenerator";
import { parseCopilotLogs } from "./log/copilotLogParser";
import { computeModelPerformance, computeTrueAcceptanceRate, computeVelocityAnalysis } from "./metrics/metricsEngine";
import type { CopilotUsageStats } from "./types";
import { CopilotUsagePanel } from "./ui/copilotUsagePanel";
import { CopilotUsageTreeProvider } from "./ui/copilotUsageTreeProvider";
import { buildDashboardPayload } from "./ui/dashboardPayload";
import { StatusBarIndicator } from "./ui/statusBarIndicator";
import { todayDateString } from "./utils";
import type { DbWorkerClient } from "./worker/dbWorkerClient";
import { DbWorkerClientImpl } from "./worker/dbWorkerClient";

let cachedStats: CopilotUsageStats | undefined;

function isAdvancedAnalysisEnabled(): boolean {
  return vscode.workspace.getConfiguration("copilot-insight").get<boolean>("enableAdvancedAnalysis", true);
}

export function activate(context: vscode.ExtensionContext) {
  // Install the inline-completion wrapper as early as possible so that any
  // provider registered after activation (including GitHub Copilot) is
  // intercepted and its show/accept events are counted in real-time.
  const inlineTracker = new InlineCompletionTracker(context);

  // Conditionally start the DB worker based on the master-toggle setting.
  const workerPath = path.join(context.extensionUri.fsPath, "dist", "worker", "dbWorker.js");
  let dbWorker: DbWorkerClient | undefined = isAdvancedAnalysisEnabled()
    ? new DbWorkerClientImpl(workerPath)
    : undefined;

  // Phase 1: Event instrumentation — capture text-change, editor-switch, and
  // completion-accept events and persist them to structured storage.
  const eventTracker = new EventTracker(context, dbWorker);

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

  // Periodically refresh the status bar from the inline tracker.
  const statusBarRefreshMs = 3_000;
  const statusBarTimer = setInterval(() => {
    statusBar.update(inlineTracker.stats);
  }, statusBarRefreshMs);

  const treeProvider = new CopilotUsageTreeProvider();

  const copilotUsageTreeView = vscode.window.createTreeView("copilotUsageView", {
    treeDataProvider: treeProvider,
  });

  /** Parse logs, cache result, and update TreeView + Panel. */
  async function refreshStats(): Promise<CopilotUsageStats> {
    const stats = await parseCopilotLogs(context.logUri);
    // Merge real-time language stats from the inline tracker.
    // The log files never contain languageId, so this is the only reliable source.
    for (const [lang, counts] of inlineTracker.stats.byLanguage) {
      const existing = stats.byLanguage.get(lang) ?? { shown: 0, accepted: 0 };
      stats.byLanguage.set(lang, {
        shown: existing.shown + counts.shown,
        accepted: existing.accepted + counts.accepted,
      });
    }
    cachedStats = stats;
    treeProvider.updateStats(stats);
    return stats;
  }

  /** Compute advanced metrics (best-effort) from tracked events. */
  function getAdvancedMetrics(stats: CopilotUsageStats) {
    const dates = eventTracker.storage.listDates();
    const allEvents = dates.flatMap((d) => eventTracker.storage.readByDate(d));
    if (allEvents.length === 0) {
      return {};
    }
    return {
      trueAcceptance: computeTrueAcceptanceRate(allEvents, stats.totalShown),
      velocity: computeVelocityAnalysis(allEvents),
      modelPerformance: computeModelPerformance(allEvents),
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
        CopilotUsagePanel.createOrShow(context.extensionUri, stats, getAdvancedMetrics(stats));
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
          CopilotUsagePanel.createOrShow(context.extensionUri, stats, getAdvancedMetrics(stats));
        }
      },
    );
  });

  const exportCsvDisposable = vscode.commands.registerCommand("copilot-insight.exportCsv", async () => {
    if (!cachedStats) {
      vscode.window.showWarningMessage('No usage data available. Run "Show Usage" first.');
      return;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder, `copilot-usage-${todayDateString()}.csv`)
        : vscode.Uri.file(`copilot-usage-${todayDateString()}.csv`),
      filters: { csv: ["csv"] },
    });
    if (uri) {
      const content = exportAsCsv(cachedStats);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  });

  const exportJsonDisposable = vscode.commands.registerCommand("copilot-insight.exportJson", async () => {
    if (!cachedStats) {
      vscode.window.showWarningMessage('No usage data available. Run "Show Usage" first.');
      return;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder, `copilot-usage-${todayDateString()}.json`)
        : vscode.Uri.file(`copilot-usage-${todayDateString()}.json`),
      filters: { json: ["json"] },
    });
    if (uri) {
      const content = exportAsJson(cachedStats);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  });

  // Phase 3: Export Markdown report with ROI estimation.
  const exportReportDisposable = vscode.commands.registerCommand("copilot-insight.exportReport", async () => {
    if (!cachedStats) {
      vscode.window.showWarningMessage('No usage data available. Run "Show Usage" first.');
      return;
    }

    // Gather events for advanced metrics (best-effort).
    const dates = eventTracker.storage.listDates();
    const allEvents = dates.flatMap((d) => eventTracker.storage.readByDate(d));

    const trueAcceptance =
      allEvents.length > 0 ? computeTrueAcceptanceRate(allEvents, cachedStats.totalShown) : undefined;
    const velocity = allEvents.length > 0 ? computeVelocityAnalysis(allEvents) : undefined;
    const modelPerformance = allEvents.length > 0 ? computeModelPerformance(allEvents) : undefined;

    const period = dates.length > 0 ? `${dates[0]} — ${dates[dates.length - 1]}` : "All available data";
    const projectName = vscode.workspace.name;

    // Build the dashboard payload to obtain consistent pre-computed ROI values and
    // auto-generated insights — this ensures the report numbers match the dashboard.
    const dashboardPayload = buildDashboardPayload(cachedStats, trueAcceptance, velocity, modelPerformance);
    const { typingMinutesSaved, agenticMinutesSaved } = dashboardPayload.summary;
    const insights = dashboardPayload.insights;

    const content = generateMarkdownReport({
      period,
      projectName,
      stats: cachedStats,
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
