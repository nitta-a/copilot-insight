import * as vscode from "vscode";
import { parseCopilotLogs } from "./copilotLogParser";
import { CopilotUsagePanel } from "./copilotUsagePanel";
import { CopilotUsageTreeProvider } from "./copilotUsageTreeProvider";
import { exportAsCsv, exportAsJson } from "./exportStats";
import type { CopilotUsageStats } from "./types";

let cachedStats: CopilotUsageStats | undefined;

export function activate(context: vscode.ExtensionContext) {
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

  const showCopilotUsageDisposable = vscode.commands.registerCommand("copilot-insight.showCopilotUsage", async () => {
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
          CopilotUsagePanel.createOrShow(context.extensionUri, stats);
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

  context.subscriptions.push(
    treeProvider,
    copilotUsageTreeView,
    showCopilotUsageDisposable,
    changeDailyUsagePeriodDisposable,
    refreshDisposable,
    exportCsvDisposable,
    exportJsonDisposable,
  );
}

export function deactivate() {}
