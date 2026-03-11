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

/** Daily timeline entry for the Efficiency Graph. */
export interface TimelineEntry {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  shown: number;
  accepted: number;
  /** Acceptance rate as percentage 0–100. */
  rate: number;
}

/** Session-level entry for the Summary Table. */
export interface SessionEntry {
  sessionId: string;
  /** ISO date string derived from the session ID (YYYY-MM-DD). */
  date: string;
  accepted: number;
  /** Estimated minutes saved for this session based on accepted completions. */
  estimatedMinSaved: number;
}

/** Complete payload sent from the extension host to the WebView. */
export interface DashboardPayload {
  /** Total number of inline completion suggestions shown. */
  totalShown: number;
  /** Total number of inline completion suggestions accepted. */
  totalAccepted: number;
  /** Acceptance rate as percentage 0–100. Zero when totalShown is 0. */
  acceptanceRate: number;
  /** Total estimated time saved in minutes (typing speed ROI + agentic ROI). */
  estimatedTimeSaved: number;
  /** Number of detected Copilot sessions. */
  activeSessions: number;
  /** Daily timeline for the Efficiency Graph. */
  timeline: TimelineEntry[];
  /** Session-level entries for the Summary Table. */
  sessions: SessionEntry[];
  /** Auto-generated insight strings (plain text, safe to render as text content). */
  insights: string[];
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
  exportType: "markdown";
  /** True when the file was actually written; false when cancelled or failed. */
  success: boolean;
}

export type HostToWebviewMessage = DashboardDataMessage | ExportCompleteMessage;

// ---------------------------------------------------------------------------
// Message types — WebView → Extension Host
// ---------------------------------------------------------------------------

/** User requested a Markdown export. */
export interface ExportMarkdownMessage {
  type: "exportMarkdown";
}

export type WebviewToHostMessage = ExportMarkdownMessage;
