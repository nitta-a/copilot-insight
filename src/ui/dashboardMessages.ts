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

export interface LanguageEntry {
  language: string;
  shown: number;
  accepted: number;
  /** Acceptance rate as percentage 0–100. */
  rate: number;
}

/** Complete payload sent from the extension host to the WebView. */
export interface DashboardPayload {
  /** Number of days shown in the timeline. */
  days: number;
  summary: SummaryData;
  timeline: TimelineEntry[];
  velocityPoints: VelocityPoint[];
  languageBreakdown: LanguageEntry[];
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

/** User selected a new display period. */
export interface ChangePeriodMessage {
  type: "changePeriod";
  payload: { days: number };
}

/** User requested a Markdown export. */
export interface ExportMarkdownMessage {
  type: "exportMarkdown";
}

/** User requested a PNG export of the charts. */
export interface ExportPngMessage {
  type: "exportPng";
  /** Base64-encoded PNG data URI produced by `canvas.toDataURL('image/png')`. */
  payload: { imageData: string };
}

export type WebviewToHostMessage = ChangePeriodMessage | ExportMarkdownMessage | ExportPngMessage;
