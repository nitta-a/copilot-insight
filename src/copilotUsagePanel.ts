import * as vscode from "vscode";
import type { CopilotUsageStats } from "./copilotLogParser";
import { getHtmlContent } from "./copilotUsageHtml";

const DEFAULT_DISPLAY_DAYS = 14;

export class CopilotUsagePanel {
  public static currentPanel: CopilotUsagePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _stats: CopilotUsageStats;
  private _days: number;

  public static createOrShow(extensionUri: vscode.Uri, stats: CopilotUsageStats): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CopilotUsagePanel.currentPanel) {
      CopilotUsagePanel.currentPanel._panel.reveal(column);
      CopilotUsagePanel.currentPanel._stats = stats;
      CopilotUsagePanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "copilotUsage",
      "GitHub Copilot Usage",
      column ?? vscode.ViewColumn.One,
      { enableScripts: false, enableCommandUris: true, localResourceRoots: [] },
    );

    CopilotUsagePanel.currentPanel = new CopilotUsagePanel(panel, extensionUri, stats);
  }

  private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri, stats: CopilotUsageStats) {
    this._panel = panel;
    this._stats = stats;
    this._days = DEFAULT_DISPLAY_DAYS;
    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public updateDays(days: number): void {
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1 || days > 365) {
      return;
    }
    this._days = days;
    this._update();
  }

  public dispose(): void {
    CopilotUsagePanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  private _update(): void {
    this._panel.webview.html = getHtmlContent(this._stats, this._days);
  }
}
