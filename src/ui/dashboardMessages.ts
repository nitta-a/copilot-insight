/**
 * Shared message protocol types for the dashboard WebView ↔ Extension Host
 * bidirectional communication via vscode.postMessage.
 *
 * These interfaces are imported at compile time by both the extension host
 * (`copilotUsagePanel.ts`) and the WebView frontend (`webview/dashboard.ts`).
 * At runtime they are erased by TypeScript, so there is no Node.js/browser
 * cross-context issue.
 */

// ---------------------------------------------------------------------------
// Payload data shapes (sent from host → webview)
// ---------------------------------------------------------------------------

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
  /** Best-performing model name (null when no model-performance data). */
  bestModel: string | null;
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
  }>;
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
  /** Auto-generated insight strings (plain text, safe to render as text content). */
  insights: string[];
  /** Weekly trend comparison data (null when insufficient data). */
  weeklyTrend: WeeklyTrendData | null;
  /** Agentic (subagent) activity statistics. */
  agenticStats: AgenticStats;
}

// ---------------------------------------------------------------------------
// Message types — Extension Host → WebView
// ---------------------------------------------------------------------------

/** Send dashboard data for (re-)rendering. */
export interface DashboardDataMessage {
  type: "dashboardData";
  payload: DashboardPayload;
}

export type HostToWebviewMessage = DashboardDataMessage;

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

export type WebviewToHostMessage = ExportMarkdownMessage | ExportPngMessage;
