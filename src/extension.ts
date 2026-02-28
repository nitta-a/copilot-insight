import * as vscode from "vscode";
import { parseCopilotLogs } from "./copilotLogParser";
import { CopilotUsagePanel } from "./copilotUsagePanel";

export function activate(context: vscode.ExtensionContext) {
  const treeDataChangeEmitter = new vscode.EventEmitter<void>();
  const copilotUsageTreeView = vscode.window.createTreeView("copilotUsageView", {
    treeDataProvider: {
      onDidChangeTreeData: treeDataChangeEmitter.event,
      getTreeItem: (e) => e,
      getChildren: () => [],
    },
  });

  const showCopilotUsageDisposable = vscode.commands.registerCommand("copilot-insight.showCopilotUsage", async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Parsing GitHub Copilot logs...",
      },
      async () => {
        const stats = await parseCopilotLogs(context.logUri);
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

  context.subscriptions.push(
    treeDataChangeEmitter,
    copilotUsageTreeView,
    showCopilotUsageDisposable,
    changeDailyUsagePeriodDisposable,
  );
}

export function deactivate() {}
