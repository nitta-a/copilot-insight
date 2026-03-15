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
  RefreshAnalysis,
  SessionDetailPayload as SessionDetailData,
  SessionSummary,
} from "../types";

export type AgentStep = AgentStepData;

// ---------------------------------------------------------------------------
// Payload data shapes (sent from host → webview)
// ---------------------------------------------------------------------------

export interface ContextFreshness {
  score: number;
  actionCount: number;
  status: "fresh" | "aging" | "exhausted";
  actionPenalty: number;
  trendPenalty: number;
  suggestedAction: "none" | "compact" | "restart";
  latestRefreshRoi: number | null;
  latestRecoveryDelta: number | null;
}

/** Breakdown of a numeric ROI metric by source category (editor vs CLI). */
export interface RoiBreakdown {
  /** Combined total across all sources. */
  total: number;
  /** Contribution from VS Code editor (inline + chat). */
  editor: number;
  /** Contribution from Copilot CLI. */
  cli: number;
}

export interface SummaryData {
  totalShown: number;
  totalAccepted: number;
  acceptanceRate: number;
  /** True acceptance rate (null when no event-tracking data is available). */
  trueAcceptanceRate: number | null;
  /** Estimated minutes saved by Copilot completions (ROI). */
  estimatedMinutesSaved: number;
  /** Minutes saved from inline completions (typing speed × accepted chars). */
  typingMinutesSaved: number;
  /** Minutes saved from AI autonomous actions (50% of autonomous duration). */
  agenticMinutesSaved: number;
  /** Most frequently used non-inline model name (null when unavailable). */
  topChatModel: string | null;
  /** Number of chat requests attributed to `topChatModel`. */
  topChatModelCount: number;
  /** Most frequently used Ask model, combining Ask and old Ask intents. */
  topAskModel: string | null;
  /** Number of Ask requests attributed to `topAskModel`. */
  topAskModelCount: number;
  /** Most frequent model among model-tagged plan proposals. */
  topPlanModel: string | null;
  /** Number of model-tagged plan proposals attributed to `topPlanModel`. */
  topPlanModelCount: number;
  /** Total estimated minutes saved with editor/CLI breakdown (for ROI display). */
  totalMinutesSaved: RoiBreakdown;
  /** Estimated time saved formatted for display (e.g. "1h 23m"). */
  estimatedTimeSaved: string;
  /** Total number of active sessions observed. */
  totalSessions: number;
}

export interface TimelineEntry {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  shown: number;
  accepted: number;
  /** True accepted count (null when no event data). */
  trueAccepted: number | null;
  /** Acceptance rate as percentage 0–100. */
  rate: number;
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
  /** Completions shown from Copilot CLI. */
  cliShown: number;
  /** Completions accepted from Copilot CLI. */
  cliAccepted: number;
}

export interface VelocityPoint {
  /** Keystrokes per minute in this window. */
  kpm: number;
  /** Number of completions accepted in this window. */
  completionsAccepted: number;
  /** Whether flow was disrupted in this window. */
  flowDisrupted: boolean;
  /** ISO-8601 timestamp of the window start (for tooltip). */
  windowStart: string;
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

export interface EvolutionPoint {
  date: string;
  /** Thinking depth: average actions per completed loop. */
  avgDepth: number;
  /** Total autonomous volume for the day in minutes. */
  totalDurationMin: number;
  /** Daily episode completion rate (0-100). */
  completionRate: number;
}

/** Agentic (subagent) activity statistics. */
export interface AgenticStats {
  /** Number of requests identified as subagent-initiated. */
  subagentRequests: number;
  /** Ratio of subagent requests to total requests (0–100). */
  agenticRatio: number;
  /** Total time (ms) during which a subagent ToolCallingLoop was active. */
  autonomousDurationMs: number;
  /** Per-intent execution counts sorted by count descending (e.g. [{intent:"runSubagent",count:5}]). */
  toolUsageStats: Array<{ intent: string; count: number }>;
  /** High-level "Agent Intelligence Overview" summary. */
  agentIntelligenceOverview: AgentIntelligenceOverview;
  /** Emerging 1.110 feature signals grouped by category. */
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

/**
 * High-level summary of agentic (subagent) activity suitable for the
 * "Agent Intelligence Overview" dashboard section.
 *
 * - All fine-grained intents (runSubagent, editAgent, searchSubagentTool, …)
 *   are collapsed into a single "Autonomous Action" count.
 * - Per-model autonomous ratios allow identifying which AI models are driving
 *   the most agentic behaviour.
 */
export interface AgentIntelligenceOverview {
  /** Total "Autonomous Action" count — all subagent intents merged. */
  autonomousActionCount: number;
  /** Number of completed ToolCallingLoop instances (distinct agentic episodes). */
  agenticLoopCount: number;
  /** Average subagent calls per completed loop. 0 when no loops have finished. */
  avgCallsPerLoop: number;
  /** Episode completion rate: completed loops / started loops * 100. 0 when no loops started. */
  completionRate: number;
  /** Total number of plans proposed by the agent (agent/plan or strategy/propose). */
  planCount: number;
  /** Number of plans that were followed by a file edit or patch application. */
  executedPlanCount: number;
  /** Planning success rate: (executedPlanCount / planCount) * 100. 0 when no plans proposed. */
  planSuccessRate: number;
  /** Number of in-plan user choice interactions (choice_selected). */
  userChoicesInPlan: number;
  /**
   * Per-model breakdown of autonomous vs total chat requests.
   * Sorted by `ratio` descending (highest autonomous ratio first).
   */
  autonomousRatioByModel: Array<{
    model: string;
    subagentCount: number;
    totalCount: number;
    /** Percentage 0–100. */
    ratio: number;
    /** Average autonomous duration per action in seconds. 0 when no duration data. */
    velocitySecondsPerAction: number;
    /** Average actions per completed agentic loop ("thinking depth"). 0 when no loops. */
    avgLoopActions: number;
    /** Task completion rate 0–100. 0 when no loops started. */
    completionRate: number;
    /** Total autonomous duration in milliseconds for this model. */
    autonomousDurationMs: number;
    /** Inline completion acceptance rate for this model (0–100). 0 when no inline data. */
    acceptanceRate: number;
    /** Total minutes saved for this model (typing + agentic). */
    totalTimeSaved: number;
    /** Total inline completions accepted for this model. */
    totalAccepted: number;
  }>;
}

/** A single bucket in the chat-session turn-count distribution. */
export interface TurnBucket {
  /** Human-readable bucket label (e.g. "1 turn", "2-3 turns"). */
  bucket: string;
  /** Total number of chat sessions that fall into this bucket. */
  sessionCount: number;
  /** Number of sessions in this bucket where code was copied or applied. */
  acceptedCount: number;
}

/** Complete payload sent from the extension host to the WebView. */
export interface DashboardPayload {
  /** Number of days shown in the timeline (equals timeline.length). */
  days: number;
  /** The full available date range present in the data. */
  availableRange: { minDate: string; maxDate: string };
  summary: SummaryData;
  timeline: TimelineEntry[];
  velocityPoints: VelocityPoint[];
  /** Daily agentic autonomy evolution series for the overview chart. */
  evolutionData: EvolutionPoint[];
  /** Auto-generated insight strings (plain text, safe to render as text content). */
  insights: string[];
  /** Weekly trend comparison data (null when insufficient data). */
  weeklyTrend: WeeklyTrendData | null;
  /** Agentic (subagent) activity statistics. */
  agenticStats: AgenticStats;
  /** Refresh ROI analysis around /compact or truncation boundaries. */
  refreshAnalysis: RefreshAnalysis[];
  /** Current-session context freshness, or null when unsupported by logs. */
  freshness: ContextFreshness | null;
  /** Precomputed session summaries for the Sessions master list. */
  sessionSummaries: SessionSummary[];
  /** Chat intent breakdown (Agent/Ask/Plan/…) sorted by count desc — for donut chart. */
  chatIntentBreakdown: CountBreakdownEntry[];
  /** Slash-command / @participant usage breakdown sorted by count desc — for donut chart. */
  commandUsageBreakdown: CountBreakdownEntry[];
  /**
   * Scatter data for the Prompt Length vs Acceptance Rate bubble chart.
   * - `x`: prompt character count midpoint of the bucket
   * - `y`: acceptance rate (0–100)
   * - `r`: bubble radius proportional to the number of samples (shown)
   */
  promptLengthScatterData: { x: number; y: number; r: number }[];
  /**
   * Top keywords extracted from chat session titles and CLI prompts,
   * sorted by frequency descending (up to 20 entries).
   */
  topKeywords: { word: string; count: number }[];
  /**
   * Turn-count distribution for chat sessions, bucketed into four ranges.
   * Used to render the Turn Churn mixed chart in the Prompt Insights tab.
   */
  turnStats: TurnBucket[];
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
  chartId?: "timeline" | "velocity" | "overview";
  /** True when the file was actually written; false when cancelled or failed. */
  success: boolean;
}

/** Send session detail after the WebView selects a session. */
export interface SessionDetailDataMessage {
  type: "sessionDetailData";
  payload: SessionDetailData | null;
}

export type HostToWebviewMessage = DashboardDataMessage | ExportCompleteMessage | SessionDetailDataMessage;

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
     */
    chartId: "timeline" | "velocity" | "overview";
  };
}

/** User selected a session in the Session Intelligence Explorer. */
export interface RequestSessionDetailMessage {
  type: "requestSessionDetail";
  payload: {
    sessionId: string;
  };
}

export type WebviewToHostMessage = ExportMarkdownMessage | ExportPngMessage | RequestSessionDetailMessage;
