import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type {
  AgentStep,
  CopilotUsageStats,
  RefreshAnalysis,
  SessionDetailPayload,
  SessionSummary,
  SessionThreadSummary,
} from "../types";
import { todayDateString } from "../utils";
import type { DbWorkerClient } from "../worker/dbWorkerClient";
import { getHtmlContent } from "./copilotUsageHtml";
import type { SessionsData, WebviewToHostMessage } from "./dashboardMessages";
import { buildDashboardPayload, buildPromptInsightsPayload, buildSessionsPayload } from "./dashboardPayload";
import { loadMoreCopilotLogs, readWorkspaceChatSessions } from "../log/copilotLogParser";
import { getLogChannel, isTimingLogsEnabled } from "../log/logChannel";

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
  /** Extension global storage path, used to cache workspace session scan results between runs. */
  globalStoragePath?: string;
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
  /** In-flight promise returned by _ensureChatSessionsLoaded — deduplicates concurrent callers. */
  private _chatSessionsLoadingPromise: Promise<void> | null = null;

  public static createOrShow(
    extensionUri: vscode.Uri,
    stats: CopilotUsageStats,
    advanced: AdvancedMetrics = {},
    dbWorker?: DbWorkerClient,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CopilotUsagePanel.currentPanel) {
      CopilotUsagePanel.currentPanel._panel.reveal(column);
      // Preserve any chat-session data already loaded into the old stats object
      // so that the Prompt Insights and Sessions tabs do not lose their data
      // when _stats is replaced with fresh parse results.
      const prevTitles = CopilotUsagePanel.currentPanel._stats.chatSessionTitles;
      const prevSessions = CopilotUsagePanel.currentPanel._stats.chatSessions;
      CopilotUsagePanel.currentPanel._stats = stats;
      if ((prevTitles?.length ?? 0) > 0) {
        CopilotUsagePanel.currentPanel._stats.chatSessionTitles = prevTitles;
      }
      if ((prevSessions?.length ?? 0) > 0) {
        CopilotUsagePanel.currentPanel._stats.chatSessions = prevSessions;
      }
      CopilotUsagePanel.currentPanel._advanced = advanced;
      CopilotUsagePanel.currentPanel._dbWorker = dbWorker;
      void CopilotUsagePanel.currentPanel._update();
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
    void this._update();
    // Pre-fetch workspaceStorage chat sessions so data is ready when the user
    // opens the Prompt Insights or Sessions tab (fire-and-forget).
    void this._ensureChatSessionsLoaded();
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
        const buildInMemoryDetail = (sessionId: string): SessionDetailPayload | null => {
          const session = (this._stats.chatSessions ?? []).find((s) => s.chatSessionId === sessionId);
          if (!session) {
            return null;
          }
          const steps: AgentStep[] = session.requests.map((req) => ({
            timestamp: new Date(req.timestamp).toISOString(),
            actor: "human" as const,
            phase: "human" as const,
            label: "Prompt" as const,
            detail: req.messageText.slice(0, 500),
            rawIntent: req.messageText.slice(0, 200),
            durationMs: req.timings.totalElapsed ?? undefined,
          }));
          const thread: SessionThreadSummary = {
            threadId: session.chatSessionId,
            title: session.title ?? session.firstRequestText?.slice(0, 80) ?? session.chatSessionId,
            startedAt: session.createdAt,
            estimatedMinutesSaved: 0,
            autonomousDurationMs: 0,
            acceptedChars: 0,
            hasAutonomousRun: false,
            stepCount: steps.length,
            longestPauseMs: 0,
            hasSelectableTitle: Boolean(session.title),
          };
          return {
            sessionId: session.chatSessionId,
            date: session.createdAt.slice(0, 10),
            totalActions: steps.length,
            trueRate: 0,
            autonomousDuration: 0,
            efficiencyScore: 0,
            timeline: [],
            episodes: [],
            fatigueMarker: null,
            threads: steps.length > 0 ? [thread] : [],
            stepsByThread: steps.length > 0 ? { [session.chatSessionId]: steps } : {},
          };
        };
        if (!this._dbWorker) {
          void this._panel.webview.postMessage({
            type: "sessionDetailData",
            payload: buildInMemoryDetail(msg.payload.sessionId),
          });
          break;
        }
        void this._dbWorker
          .getSessionDetail(msg.payload.sessionId)
          .then((payload) => {
            void this._panel.webview.postMessage({ type: "sessionDetailData", payload });
          })
          .catch(() => {
            void this._panel.webview.postMessage({
              type: "sessionDetailData",
              payload: buildInMemoryDetail(msg.payload.sessionId),
            });
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
      case "openDocument": {
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(msg.filePath));
        break;
      }
    }
  }

  /**
   * Read workspaceStorage chat session data once and cache it into `this._stats`.
   * Idempotent — concurrent callers share the same in-flight promise so only one
   * filesystem scan ever runs at a time.
   */
  private _ensureChatSessionsLoaded(): Promise<void> {
    if (this._chatSessionsLoaded) {
      return Promise.resolve();
    }
    if (!this._advanced.logBaseDir) {
      return Promise.resolve();
    }
    if (this._chatSessionsLoadingPromise) {
      return this._chatSessionsLoadingPromise;
    }
    this._chatSessionsLoadingPromise = (async () => {
      try {
        const { chatSessionTitles, chatSessions } = await readWorkspaceChatSessions(this._advanced.logBaseDir, {
          storagePath: this._advanced.globalStoragePath,
        });
        this._stats.chatSessionTitles = chatSessionTitles;
        this._stats.chatSessions = chatSessions;
      } catch {
        // Non-fatal — workspace storage may not exist in all environments.
      }
      this._chatSessionsLoaded = true;
      this._chatSessionsLoadingPromise = null;
    })();
    return this._chatSessionsLoadingPromise;
  }

  /**
   * Load chat sessions (once) then post the Prompt Insights payload.
   * Separated so `_handleWebviewMessage` can fire-and-forget with `void`.
   */
  private async _handlePromptInsightsTabRequest(): Promise<void> {
    const timingEnabled = isTimingLogsEnabled();
    const channel = getLogChannel();
    const t0 = timingEnabled ? performance.now() : 0;

    await this._ensureChatSessionsLoaded();
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] promptInsights.ensureChatSessionsLoaded: ${(performance.now() - t0).toFixed(1)}ms | ` +
          `titles=${this._stats.chatSessionTitles?.length ?? 0}, sessions=${this._stats.chatSessions?.length ?? 0}`,
      );
    }

    const t1 = timingEnabled ? performance.now() : 0;
    const payload = buildPromptInsightsPayload(this._stats);
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] promptInsights.buildPayload: ${(performance.now() - t1).toFixed(1)}ms | ` +
          `keywords=${payload.topKeywords?.length ?? 0}`,
      );
      channel.appendLine(`[TIMING] promptInsights total: ${(performance.now() - t0).toFixed(1)}ms`);
    }

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
    const timingEnabled = isTimingLogsEnabled();
    const channel = getLogChannel();
    const buildStartMs = performance.now();

    await this._ensureChatSessionsLoaded();
    if (this._advanced.logBaseDir && this._dbWorker) {
      try {
        const { chatSessionTitles, chatSessions } =
          (this._stats.chatSessionTitles?.length ?? 0) > 0 || (this._stats.chatSessions?.length ?? 0) > 0
            ? {
                chatSessionTitles: this._stats.chatSessionTitles ?? [],
                chatSessions: this._stats.chatSessions ?? [],
              }
            : await readWorkspaceChatSessions(this._advanced.logBaseDir, {
                storagePath: this._advanced.globalStoragePath,
              });
        if (timingEnabled) {
          channel.appendLine(
            `[TIMING] sessions.readWorkspaceChat: ${(performance.now() - buildStartMs).toFixed(1)}ms | ${chatSessionTitles.length} title(s), ${chatSessions.length} session(s)`,
          );
        }

        let phaseMs = performance.now();
        await this._dbWorker.setChatSessionTitles(chatSessionTitles);
        await this._dbWorker.setChatSessions(chatSessions);
        if (timingEnabled) {
          channel.appendLine(`[TIMING] sessions.dbSet: ${(performance.now() - phaseMs).toFixed(1)}ms`);
        }

        phaseMs = performance.now();
        const sessionSummaries = await this._dbWorker.getSessionList();
        if (timingEnabled) {
          channel.appendLine(
            `[TIMING] sessions.getSessionList: ${(performance.now() - phaseMs).toFixed(1)}ms | ${sessionSummaries.length} summary(ies)`,
          );
          channel.appendLine(
            `[TIMING] _buildSessionsPayload total: ${(performance.now() - buildStartMs).toFixed(1)}ms`,
          );
        }
        return buildSessionsPayload(this._stats, sessionSummaries);
      } catch {
        if (timingEnabled) {
          channel.appendLine(`[TIMING] _buildSessionsPayload: dbWorker unavailable, using in-memory fallback`);
        }
        // fall through to in-memory fallback
      }
    }
    // No logBaseDir or no dbWorker — fall back to in-memory stats
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] _buildSessionsPayload total: ${(performance.now() - buildStartMs).toFixed(1)}ms [in-memory fallback]`,
      );
    }
    const chatSessions = this._stats.chatSessions ?? [];
    if (chatSessions.length > 0) {
      const summaries: SessionSummary[] = chatSessions
        .map((s) => ({
          sessionId: s.chatSessionId,
          title: s.title ?? s.firstRequestText?.slice(0, 80) ?? null,
          date: s.createdAt?.slice(0, 10) ?? s.lastMessageAt?.slice(0, 10) ?? "",
          totalActions: s.requests.length,
          trueRate: 0,
          autonomousDuration: 0,
          efficiencyScore: 0,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
      return buildSessionsPayload(this._stats, summaries);
    }
    return buildSessionsPayload(this._stats, this._advanced.sessionSummaries);
  }

  private _savePng(dataUri: string, chartId: "timeline" | "velocity" | "overview" | "full-dashboard"): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultFilename =
      chartId === "full-dashboard"
        ? `copilot-dashboard-full-${todayDateString()}.png`
        : `copilot-dashboard-${todayDateString()}.png`;
    vscode.window
      .showSaveDialog({
        defaultUri: workspaceFolder
          ? vscode.Uri.joinPath(workspaceFolder, defaultFilename)
          : vscode.Uri.file(defaultFilename),
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
    // Wait for any in-flight chat-session scan before starting the full
    // log re-parse so both don't compete for filesystem I/O.
    await this._ensureChatSessionsLoaded();
    try {
      const prevChatSessions = this._stats.chatSessions;
      const prevChatSessionTitles = this._stats.chatSessionTitles;
      const fullStats = await loadMoreCopilotLogs(this._advanced.logUri);
      this._stats = fullStats;
      this._stats.chatSessions = prevChatSessions;
      this._stats.chatSessionTitles = prevChatSessionTitles;
      this._advanced = { ...this._advanced, hasMoreData: false };
      await this._update();
    } catch (err) {
      vscode.window.showWarningMessage(
        `Copilot Insight: could not load historical data — ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  private async _update(): Promise<void> {
    const timingEnabled = isTimingLogsEnabled();
    const channel = getLogChannel();
    const updateStartMs = performance.now();

    const nonce = getNonce();
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "dashboard.js"),
    );

    let phaseMs = performance.now();
    channel.appendLine(`[TIMING] _update.buildPayload: start`);
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
    channel.appendLine(`[TIMING] _update.buildPayload: done | ${(performance.now() - phaseMs).toFixed(1)}ms`);

    phaseMs = performance.now();
    channel.appendLine(`[TIMING] _update.setHtml: start`);
    this._panel.webview.html = getHtmlContent(this._stats, nonce, scriptUri.toString(), payload);
    channel.appendLine(`[TIMING] _update.setHtml: done | ${(performance.now() - phaseMs).toFixed(1)}ms`);

    // Also push an update via postMessage so the WebView re-renders without
    // a full HTML reload (e.g. when only the period changes after first load).
    phaseMs = performance.now();
    channel.appendLine(`[TIMING] _update.postMessage: sending`);
    this._panel.webview.postMessage({ type: "dashboardData", payload });
    channel.appendLine(`[TIMING] _update total: ${(performance.now() - updateStartMs).toFixed(1)}ms`);
  }
}
