import * as vscode from "vscode";
import { parseCopilotLogs } from "./log/copilotLogParser";
import { CopilotUsagePanel } from "./ui/copilotUsagePanel";
import { CopilotUsageTreeProvider } from "./ui/copilotUsageTreeProvider";
import { EventTracker } from "./events/eventTracker";
import { exportAsCsv, exportAsJson } from "./export/exportStats";
import { InlineCompletionTracker } from "./events/inlineCompletionWrapper";
import { computeModelPerformance, computeTrueAcceptanceRate, computeVelocityAnalysis } from "./metrics/metricsEngine";
import { generateMarkdownReport } from "./export/reportGenerator";
import { StatusBarIndicator } from "./ui/statusBarIndicator";
import type { CopilotUsageStats } from "./types";

let cachedStats: CopilotUsageStats | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Install the inline-completion wrapper as early as possible so that any
  // provider registered after activation (including GitHub Copilot) is
  // intercepted and its show/accept events are counted in real-time.
  const inlineTracker = new InlineCompletionTracker(context);

  // Phase 1: Event instrumentation — capture text-change, editor-switch, and
  // completion-accept events and persist them to structured storage.
  const eventTracker = new EventTracker(context);

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

  const changeDailyUsagePeriodDisposable = vscode.commands.registerCommand(
    "copilot-insight.changeDailyUsagePeriod",
    (days: number) => {
      CopilotUsagePanel.currentPanel?.updateDays(days);
    },
  );

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
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file("copilot-usage.csv"),
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
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file("copilot-usage.json"),
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

    const content = generateMarkdownReport({
      period,
      projectName,
      stats: cachedStats,
      trueAcceptance,
      velocity,
      modelPerformance,
    });

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file("copilot-usage-report.md"),
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
    { dispose: () => clearInterval(statusBarTimer) },
    showCopilotUsageDisposable,
    changeDailyUsagePeriodDisposable,
    refreshDisposable,
    exportCsvDisposable,
    exportJsonDisposable,
    exportReportDisposable,
  );
}

export function deactivate() {}
