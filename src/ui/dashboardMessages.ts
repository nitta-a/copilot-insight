/**
 * Shared message protocol types for the dashboard WebView ↔ Extension Host
 * bidirectional communication via vscode.postMessage.
 *
 * These interfaces are imported at compile time by both the extension host
 * (`copilotUsagePanel.ts`) and the WebView frontend (`webview/dashboard.ts`).
 * At runtime they are erased by TypeScript, so there is no Node.js/browser
 * cross-context issue.
 */

import type {
  AgentStep as AgentStepData,
  SessionDetailPayload as SessionDetailData,
  SessionSummary,
} from "../types";

export type AgentStep = AgentStepData;

// ---------------------------------------------------------------------------
// Payload data shapes (sent from host → webview)
// ---------------------------------------------------------------------------

export interface SummaryData {
  totalShown: number;
  totalAccepted: number;
  acceptanceRate: number;
  /** Most frequently used non-inline model name (null when unavailable). */
  topChatModel: string | null;
  /** Number of chat requests attributed to `topChatModel`. */
  topChatModelCount: number;
  /** Total number of active sessions observed. */
  totalSessions: number;
  /**
   * Aggregated token consumption summary.
   * `null` when no log entries carried token-count fields.
   */
  tokenStats: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    /** Average prompt tokens per request (0 when no data). */
    avgPromptTokensPerRequest: number;
    /** Top models by total token consumption (descending). */
    topModelsByTokens: Array<{ model: string; promptTokens: number; completionTokens: number }>;
  } | null;
  /** Copilot CLI usage from local session records; null when unavailable. */
  cliUsageStats: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    totalAiCredits: number | null;
    topModels: Array<{ model: string; totalTokens: number; aiCredits: number | null }>;
    projects: Array<{
      path: string | null;
      name: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      aiCredits: number | null;
      dailyUsage: Array<{ date: string; usage: import("../types").CliUsageStat }>;
    }> | null;
    projectDailyUsageAvailable: boolean;
    dailyUsage: DailyUsagePoint[];
    fusionRuns?: import("../types").FusionRun[];
    modelCalls?: import("../types").CliDiagnostics["modelCalls"];
    interventionThreads?: Array<{ projectPath?: string | null; interventions?: import("../types").CliInterventions }>;
    /** Signed difference between cumulative totals and timestamped call records. */
    unattributedTokens: number;
    unattributedAiCredits: number | null;
  } | null;
}

export interface DailyUsagePoint {
  /** Date of the model call in UTC, not the session start or checkpoint date. */
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  aiCredits: number | null;
}

export interface TimelineEntry {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  shown: number;
  accepted: number;
  /** Acceptance rate as percentage 0–100, or null when no suggestions were shown. */
  rate: number | null;
  /** True when this day's acceptance rate is a statistical anomaly (|z| > threshold). */
  isAnomaly: boolean;
  /** Human-readable explanation of why this day is anomalous, or null when not anomalous. */
  anomalyReason: string | null;

  // ── Source-category breakdown (Editor vs CLI) ────────────────────────
  /** Inline completions shown from VS Code editor. */
  editorShown: number;
  /** Inline completions accepted from VS Code editor. */
  editorAccepted: number;
  /** Chat interactions from VS Code editor for this day. */
  chatCount: number;
  /** Human prompts recorded by Copilot CLI or SDK. */
  cliPrompts: number;
}

export interface WeekStat {
  shown: number;
  accepted: number;
  /** Acceptance rate as percentage 0–100. */
  rate: number;
  chat: number;
}

export interface WeeklyTrendData {
  thisWeek: WeekStat;
  lastWeek: WeekStat;
  /** Acceptance rate difference (thisWeek.rate - lastWeek.rate). Positive = improved. */
  rateDiff: number;
}

/** Agentic (subagent) activity statistics. */
export interface AgenticStats {
  /** Number of requests identified as subagent-initiated. */
  subagentRequests: number;
  /** Total time (ms) during which a subagent ToolCallingLoop was active. */
  autonomousDurationMs: number;
  /** Per-intent execution counts sorted by count descending (e.g. [{intent:"runSubagent",count:5}]). */
  toolUsageStats: Array<{ intent: string; count: number }>;
  /** CLI tool execution stats sorted by total count descending. */
  cliToolExecutions: Array<{ name: string; total: number; success: number; fail: number; successRate: number }>;
  /** CLI subagent type counts sorted by count descending. */
  cliAgentTypes: Array<{ name: string; count: number; share: number }>;
  /** Observed events grouped by category. */
  featureSignals: AgenticFeatureSignals;
}

export interface CountBreakdownEntry {
  name: string;
  count: number;
}

export interface FeatureSignalCategory {
  total: number;
  breakdown: CountBreakdownEntry[];
}

export interface AgenticFeatureSignals {
  browserTools: FeatureSignalCategory;
  pluginOrSkills: FeatureSignalCategory;
  memoryManagement: FeatureSignalCategory;
  agentDebug: FeatureSignalCategory;
}

/** A single bucket in the chat-session turn-count distribution. */
export interface TurnBucket {
  /** Human-readable request-count bucket label. */
  bucket: string;
  /** Total number of chat sessions that fall into this bucket. */
  sessionCount: number;
}

/**
 * Lazy-loaded payload for the Prompt Insights tab.
 * Requested on demand when the user clicks "Load Data" on the Prompt Insights tab.
 */
export interface PromptInsightsData {
  /** Chat intent breakdown (Agent/Ask/Plan/…) sorted by count desc — for donut chart. */
  chatIntentBreakdown: CountBreakdownEntry[];
  /** Slash-command / @participant usage breakdown sorted by count desc — for donut chart. */
  commandUsageBreakdown: CountBreakdownEntry[];
  /** Completion finish-reason breakdown sorted by count desc (e.g. stop, length). */
  finishReasonBreakdown: CountBreakdownEntry[];
  /**
   * Scatter data for the Prompt Length vs Observed Response Rate bubble chart.
   * - `x`: prompt character count midpoint of the bucket
   * - `y`: observed response rate (0–100)
   * - `r`: bubble radius proportional to the number of samples (shown)
   */
  promptLengthScatterData: { x: number; y: number; r: number }[];
  /**
   * Top keywords extracted from chat session titles and CLI prompts,
   * sorted by frequency descending (up to 20 entries).
   */
  topKeywords: { word: string; count: number }[];
  /**
   * Request-count distribution for saved VS Code chat sessions.
   */
  turnStats: TurnBucket[];
}

/**
 * Lazy-loaded payload for the Sessions tab.
 * Requested on demand when the user clicks "Load Data" on the Sessions tab.
 */
export interface SessionsData {
  /** Precomputed session summaries for the Sessions master list. */
  sessionSummaries: SessionSummary[];
}

/** Complete payload sent from the extension host to the WebView. */
export interface DashboardPayload {
  /** Number of days shown in the timeline (equals timeline.length). */
  days: number;
  /** The full available date range present in the data. */
  availableRange: { minDate: string; maxDate: string };
  summary: SummaryData;
  timeline: TimelineEntry[];
  /** Auto-generated insight strings (plain text, safe to render as text content). */
  insights: string[];
  /** Weekly trend comparison data (null when insufficient data). */
  weeklyTrend: WeeklyTrendData | null;
  /** Agentic (subagent) activity statistics. */
  agenticStats: AgenticStats;
  /**
   * True when only a limited number of recent sessions were parsed during the
   * initial load.  The WebView should show a "Load Historical Data" button that
   * sends a `loadMoreData` message to trigger a full re-parse.
   */
  hasMoreData: boolean;
}

// ---------------------------------------------------------------------------
// Message types — Extension Host → WebView
// ---------------------------------------------------------------------------

/** Send dashboard data for (re-)rendering. */
export interface DashboardDataMessage {
  type: "dashboardData";
  payload: DashboardPayload;
}

/** Notify the WebView that an export operation has finished (or was cancelled). */
export interface ExportCompleteMessage {
  type: "exportComplete";
  /** Which export triggered this completion event. */
  exportType: "markdown" | "png";
  /** Chart ID for PNG exports; undefined for markdown. */
  chartId?: "timeline" | "velocity" | "overview" | "full-dashboard";
  /** True when the file was actually written; false when cancelled or failed. */
  success: boolean;
}

/** Send session detail after the WebView selects a session. */
export interface SessionDetailDataMessage {
  type: "sessionDetailData";
  payload: SessionDetailData | null;
}

/** Send lazy-loaded tab data in response to a requestTabData message. */
export interface TabDataMessage {
  type: "tabData";
  tab: "promptInsights" | "sessions";
  payload: PromptInsightsData | SessionsData;
}

export type HostToWebviewMessage =
  | DashboardDataMessage
  | ExportCompleteMessage
  | SessionDetailDataMessage
  | TabDataMessage;

// ---------------------------------------------------------------------------
// Message types — WebView → Extension Host
// ---------------------------------------------------------------------------

/** User requested a Markdown export. */
export interface ExportMarkdownMessage {
  type: "exportMarkdown";
}

/** User requested a PNG export of the charts. */
export interface ExportPngMessage {
  type: "exportPng";
  /** Base64-encoded PNG data URI produced by `canvas.toDataURL('image/png')`. */
  payload: {
    imageData: string;
    /**
     * Identifier of the chart being exported.
     * - `"timeline"`: Health tab Timeline chart (Chart.js canvas).
     * - `"velocity"`: Flow tab Velocity Correlation chart (Chart.js canvas).
     * - `"overview"`: Overview tab Agentic Efficiency SVG chart.
     * - `"full-dashboard"`: All visible cards in the active dashboard tab.
     */
    chartId: "timeline" | "velocity" | "overview" | "full-dashboard";
  };
}

/** User selected a session in the Session Intelligence Explorer. */
export interface RequestSessionDetailMessage {
  type: "requestSessionDetail";
  payload: {
    sessionId: string;
  };
}

/** WebView requests lazy tab data to be computed and returned by the host. */
export interface RequestTabDataMessage {
  type: "requestTabData";
  tab: "promptInsights" | "sessions";
}

/** WebView requests that the remaining (historical) log sessions be loaded. */
export interface LoadMoreDataMessage {
  type: "loadMoreData";
}

/** WebView requests the extension host to open a file in the editor. */
export interface OpenDocumentMessage {
  type: "openDocument";
  filePath: string;
}

export type WebviewToHostMessage =
  | ExportMarkdownMessage
  | ExportPngMessage
  | RequestSessionDetailMessage
  | RequestTabDataMessage
  | LoadMoreDataMessage
  | OpenDocumentMessage;
