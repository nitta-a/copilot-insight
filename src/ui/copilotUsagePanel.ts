import * as vscode from "vscode";
import * as crypto from "node:crypto";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type { CopilotUsageStats, RefreshAnalysis } from "../types";
import { todayDateString } from "../utils";
import { getHtmlContent } from "./copilotUsageHtml";
import type { WebviewToHostMessage } from "./dashboardMessages";
import { buildDashboardPayload } from "./dashboardPayload";

/** Cryptographically secure nonce for the WebView Content-Security-Policy. */
function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Optional advanced-metrics bundle passed alongside the basic log stats. */
export interface AdvancedMetrics {
  trueAcceptance?: TrueAcceptanceResult;
  velocity?: VelocityAnalysisResult;
  modelPerformance?: ModelPerformanceResult;
  refreshAnalysis?: RefreshAnalysis[];
}

export class CopilotUsagePanel {
  public static currentPanel: CopilotUsagePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _disposables: vscode.Disposable[] = [];
  private _stats: CopilotUsageStats;
  private _advanced: AdvancedMetrics;

  public static createOrShow(extensionUri: vscode.Uri, stats: CopilotUsageStats, advanced: AdvancedMetrics = {}): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CopilotUsagePanel.currentPanel) {
      CopilotUsagePanel.currentPanel._panel.reveal(column);
      CopilotUsagePanel.currentPanel._stats = stats;
      CopilotUsagePanel.currentPanel._advanced = advanced;
      CopilotUsagePanel.currentPanel._update();
      return;
    }

    const webviewDistUri = vscode.Uri.joinPath(extensionUri, "dist", "webview");
    const panel = vscode.window.createWebviewPanel(
      "copilotUsage",
      "GitHub Copilot Usage",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: true,
        localResourceRoots: [webviewDistUri],
      },
    );

    CopilotUsagePanel.currentPanel = new CopilotUsagePanel(panel, extensionUri, stats, advanced);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    stats: CopilotUsageStats,
    advanced: AdvancedMetrics,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._stats = stats;
    this._advanced = advanced;
    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the WebView
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => this._handleWebviewMessage(msg),
      null,
      this._disposables,
    );
  }

  public dispose(): void {
    CopilotUsagePanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  private _handleWebviewMessage(msg: WebviewToHostMessage): void {
    switch (msg.type) {
      case "exportMarkdown": {
        Promise.resolve(vscode.commands.executeCommand("copilot-insight.exportReport"))
          .then(() => {
            this._panel.webview.postMessage({ type: "exportComplete", exportType: "markdown", success: true });
          })
          .catch(() => {
            this._panel.webview.postMessage({ type: "exportComplete", exportType: "markdown", success: false });
          });
        break;
      }
      case "exportPng": {
        this._savePng(msg.payload.imageData, msg.payload.chartId);
        break;
      }
    }
  }

  private _savePng(dataUri: string, chartId: "timeline" | "velocity" | "overview"): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    vscode.window
      .showSaveDialog({
        defaultUri: workspaceFolder
          ? vscode.Uri.joinPath(workspaceFolder, `copilot-dashboard-${todayDateString()}.png`)
          : vscode.Uri.file(`copilot-dashboard-${todayDateString()}.png`),
        filters: { png: ["png"] },
      })
      .then((uri) => {
        if (!uri) {
          this._panel.webview.postMessage({ type: "exportComplete", exportType: "png", chartId, success: false });
          return;
        }
        // Strip the data: prefix (e.g. "data:image/png;base64,...")
        const base64 = dataUri.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        Promise.resolve(vscode.workspace.fs.writeFile(uri, buffer))
          .then(() => {
            vscode.window.showInformationMessage(`Dashboard chart exported to ${uri.fsPath}`);
            this._panel.webview.postMessage({ type: "exportComplete", exportType: "png", chartId, success: true });
          })
          .catch((err: Error) => {
            vscode.window.showErrorMessage(`Failed to export chart: ${err.message}`);
            this._panel.webview.postMessage({ type: "exportComplete", exportType: "png", chartId, success: false });
          });
      });
  }

  private _update(): void {
    const nonce = getNonce();
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "dashboard.js"),
    );
    const payload = buildDashboardPayload(
      this._stats,
      this._advanced.trueAcceptance,
      this._advanced.velocity,
      this._advanced.modelPerformance,
      this._advanced.refreshAnalysis,
    );
    this._panel.webview.html = getHtmlContent(this._stats, nonce, scriptUri.toString(), payload);

    // Also push an update via postMessage so the WebView re-renders without
    // a full HTML reload (e.g. when only the period changes after first load).
    this._panel.webview.postMessage({ type: "dashboardData", payload });
  }
}
