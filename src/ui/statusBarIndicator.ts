import * as vscode from "vscode";

/** Status-bar shortcut to the dashboard. */
export class StatusBarIndicator implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "copilot-insight.showCopilotUsage";
    this.item.text = "$(copilot) Insight";
    this.item.tooltip = "Copilot Insight: Live inline-completion tracking is unavailable. Click to open the dashboard.";
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
