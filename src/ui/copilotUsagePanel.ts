import * as vscode from "vscode";
import * as crypto from "node:crypto";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type { CopilotUsageStats, RefreshAnalysis, SessionSummary } from "../types";
import { todayDateString } from "../utils";
import type { DbWorkerClient } from "../worker/dbWorkerClient";
import { getHtmlContent } from "./copilotUsageHtml";
import type { SessionsData, WebviewToHostMessage } from "./dashboardMessages";
import { buildDashboardPayload, buildPromptInsightsPayload, buildSessionsPayload } from "./dashboardPayload";
import { loadMoreCopilotLogs, readWorkspaceChatSessions } from "../log/copilotLogParser";

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
  sessionSummaries?: SessionSummary[];
  /**
   * VS Code log base directory (parent of session directories), used to
   * perform deferred workspace storage SQLite reads when the Sessions tab
   * is first opened.  Derived via `resolveLogSearchPaths(context.logUri.fsPath).logBaseDir`.
   */
  logBaseDir?: string;
  /**
   * The VS Code log URI passed to the extension context, used to perform a
   * full re-parse when the user requests historical data.
   */
  logUri?: vscode.Uri;
  /**
   * True when the initial parse was limited to a subset of recent sessions
   * and older sessions are still available to load.
   */
  hasMoreData?: boolean;
}

export class CopilotUsagePanel {
  public static currentPanel: CopilotUsagePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _disposables: vscode.Disposable[] = [];
  private _stats: CopilotUsageStats;
  private _advanced: AdvancedMetrics;
  private _dbWorker: DbWorkerClient | undefined;
  /** Guard against reading workspaceStorage chat sessions more than once. */
  private _chatSessionsLoaded = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    stats: CopilotUsageStats,
    advanced: AdvancedMetrics = {},
    dbWorker?: DbWorkerClient,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CopilotUsagePanel.currentPanel) {
      CopilotUsagePanel.currentPanel._panel.reveal(column);
      CopilotUsagePanel.currentPanel._stats = stats;
      CopilotUsagePanel.currentPanel._advanced = advanced;
      CopilotUsagePanel.currentPanel._dbWorker = dbWorker;
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

    CopilotUsagePanel.currentPanel = new CopilotUsagePanel(panel, extensionUri, stats, advanced, dbWorker);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    stats: CopilotUsageStats,
    advanced: AdvancedMetrics,
    dbWorker?: DbWorkerClient,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._stats = stats;
    this._advanced = advanced;
    this._dbWorker = dbWorker;
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
      case "requestSessionDetail": {
        if (!this._dbWorker) {
          void this._panel.webview.postMessage({ type: "sessionDetailData", payload: null });
          break;
        }
        void this._dbWorker
          .getSessionDetail(msg.payload.sessionId)
          .then((payload) => {
            void this._panel.webview.postMessage({ type: "sessionDetailData", payload });
          })
          .catch(() => {
            void this._panel.webview.postMessage({ type: "sessionDetailData", payload: null });
          });
        break;
      }
      case "requestTabData": {
        if (msg.tab === "promptInsights") {
          void this._handlePromptInsightsTabRequest();
        } else if (msg.tab === "sessions") {
          void this._handleSessionsTabRequest();
        }
        break;
      }
      case "loadMoreData": {
        void this._handleLoadMoreData();
        break;
      }
    }
  }

  /**
   * Read workspaceStorage chat session data once and cache it into `this._stats`.
   * Idempotent — subsequent calls are no-ops.
   */
  private async _ensureChatSessionsLoaded(): Promise<void> {
    if (this._chatSessionsLoaded) {
      return;
    }
    if (!this._advanced.logBaseDir) {
      return;
    }
    try {
      const { chatSessionTitles, chatSessions } = await readWorkspaceChatSessions(this._advanced.logBaseDir);
      this._stats.chatSessionTitles = chatSessionTitles;
      this._stats.chatSessions = chatSessions;
    } catch {
      // Non-fatal — workspace storage may not exist in all environments.
    }
    this._chatSessionsLoaded = true;
  }

  /**
   * Load chat sessions (once) then post the Prompt Insights payload.
   * Separated so `_handleWebviewMessage` can fire-and-forget with `void`.
   */
  private async _handlePromptInsightsTabRequest(): Promise<void> {
    await this._ensureChatSessionsLoaded();
    const payload = buildPromptInsightsPayload(this._stats);
    void this._panel.webview.postMessage({ type: "tabData", tab: "promptInsights", payload });
  }

  /**
   * Perform the deferred workspace storage SQLite reads, populate the DB worker,
   * and post the Sessions tab payload back to the WebView.
   *
   * Separated into its own async method so the synchronous `_handleWebviewMessage`
   * switch can fire-and-forget with `void`.
   */
  private async _handleSessionsTabRequest(): Promise<void> {
    let payload: SessionsData;
    try {
      payload = await this._buildSessionsPayloadAsync();
    } catch (err) {
      // Log to the output channel so the user can diagnose workspace storage issues.
      vscode.window.showWarningMessage(
        `Copilot Insight: could not load Sessions data — ${err instanceof Error ? err.message : "unknown error"}`,
      );
      payload = buildSessionsPayload(this._stats, []);
    }
    void this._panel.webview.postMessage({ type: "tabData", tab: "sessions", payload });
  }

  private async _buildSessionsPayloadAsync(): Promise<SessionsData> {
    await this._ensureChatSessionsLoaded();
    if (this._advanced.logBaseDir && this._dbWorker) {
      const { chatSessionTitles, chatSessions } =
        this._stats.chatSessionTitles && this._stats.chatSessions
          ? { chatSessionTitles: this._stats.chatSessionTitles, chatSessions: this._stats.chatSessions }
          : await readWorkspaceChatSessions(this._advanced.logBaseDir);
      await this._dbWorker.setChatSessionTitles(chatSessionTitles);
      await this._dbWorker.setChatSessions(chatSessions);
      const sessionSummaries = await this._dbWorker.getSessionList();
      return buildSessionsPayload(this._stats, sessionSummaries);
    }
    // No logBaseDir or no dbWorker — fall back to in-memory stats
    return buildSessionsPayload(this._stats, this._advanced.sessionSummaries);
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

  /**
   * Perform a full re-parse of all available log sessions and update the
   * dashboard with the complete historical data.
   *
   * Called when the user presses "Load Historical Data" in the WebView.
   */
  private async _handleLoadMoreData(): Promise<void> {
    if (!this._advanced.logUri) {
      return;
    }
    try {
      const fullStats = await loadMoreCopilotLogs(this._advanced.logUri);
      this._stats = fullStats;
      this._advanced = { ...this._advanced, hasMoreData: false };
      this._update();
    } catch (err) {
      vscode.window.showWarningMessage(
        `Copilot Insight: could not load historical data — ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
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
      this._advanced.sessionSummaries,
      vscode.workspace.getConfiguration("copilot-insight").get<number>("cliRoiMinutesPerInteraction") ?? 30,
      this._advanced.hasMoreData ?? false,
    );
    this._panel.webview.html = getHtmlContent(this._stats, nonce, scriptUri.toString(), payload);

    // Also push an update via postMessage so the WebView re-renders without
    // a full HTML reload (e.g. when only the period changes after first load).
    this._panel.webview.postMessage({ type: "dashboardData", payload });
  }
}
