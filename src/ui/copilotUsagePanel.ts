import * as vscode from "vscode";
import * as crypto from "node:crypto";
import type { CopilotUsageStats } from "../types";
import { todayDateString } from "../utils";
import { getHtmlContent } from "./copilotUsageHtml";
import type { WebviewToHostMessage } from "./dashboardMessages";
import { buildDashboardPayload } from "./dashboardPayload";

/** Cryptographically secure nonce for the WebView Content-Security-Policy. */
function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export class CopilotUsagePanel {
  public static currentPanel: CopilotUsagePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _disposables: vscode.Disposable[] = [];
  private _stats: CopilotUsageStats;

  public static createOrShow(extensionUri: vscode.Uri, stats: CopilotUsageStats): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CopilotUsagePanel.currentPanel) {
      CopilotUsagePanel.currentPanel._panel.reveal(column);
      CopilotUsagePanel.currentPanel._stats = stats;
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

    CopilotUsagePanel.currentPanel = new CopilotUsagePanel(panel, extensionUri, stats);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, stats: CopilotUsageStats) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._stats = stats;
    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Auto-refresh when panel becomes visible again (e.g. user switches back to it).
    this._panel.onDidChangeViewState(
      ({ webviewPanel }) => {
        if (webviewPanel.visible) {
          this._pushData();
        }
      },
      null,
      this._disposables,
    );

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
    if (msg.type === "exportMarkdown") {
      Promise.resolve(vscode.commands.executeCommand("copilot-insight.exportReport"))
        .then(() => {
          this._panel.webview.postMessage({ type: "exportComplete", exportType: "markdown", success: true });
        })
        .catch(() => {
          this._panel.webview.postMessage({ type: "exportComplete", exportType: "markdown", success: false });
        });
    }
  }

  private _savePng(dataUri: string): void {
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
          return;
        }
        const base64 = dataUri.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        Promise.resolve(vscode.workspace.fs.writeFile(uri, buffer))
          .then(() => {
            vscode.window.showInformationMessage(`Dashboard chart exported to ${uri.fsPath}`);
          })
          .catch((err: Error) => {
            vscode.window.showErrorMessage(`Failed to export chart: ${err.message}`);
          });
      });
  }

  /** Send the latest payload to the WebView via postMessage without a full HTML reload. */
  private _pushData(): void {
    const payload = buildDashboardPayload(this._stats);
    void this._panel.webview.postMessage({ type: "dashboardData", payload });
  }

  private _update(): void {
    const nonce = getNonce();
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "dashboard.js"),
    );
    const payload = buildDashboardPayload(this._stats);
    this._panel.webview.html = getHtmlContent(nonce, scriptUri.toString(), payload);

    // Also push via postMessage so the WebView can re-render without a full HTML reload.
    void this._panel.webview.postMessage({ type: "dashboardData", payload });
  }
}
