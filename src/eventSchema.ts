/**
 * Event schema types for the instrumentation pipeline.
 *
 * Phase 2 of the implementation roadmap: structured data model for events
 * captured by the VS Code event listeners (Phase 1) and persisted to storage
 * (Phase 3).
 *
 * Each event carries common fields (`sessionId`, `timestamp`, `eventType`,
 * `languageId`) plus event-specific payload.
 */

/** Discriminated union of all event types emitted by the tracker. */
export type TrackedEvent = TextChangeEvent | CompletionAcceptEvent | EditorSwitchEvent;

/** Common fields shared by every tracked event. */
export interface BaseEvent {
  /** Unique identifier for the VS Code session (derived from `context.logUri`). */
  sessionId: string;
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** Discriminator for the event union. */
  eventType: string;
  /** VS Code `languageId` of the active document, or `""` if unknown. */
  languageId: string;
}

/** Emitted on `onDidChangeTextDocument` with aggregated character counts. */
export interface TextChangeEvent extends BaseEvent {
  eventType: "textChange";
  /** Number of characters inserted across all content changes in this event. */
  charsAdded: number;
  /** Number of characters deleted across all content changes in this event. */
  charsDeleted: number;
}

/** Emitted when an inline completion (Copilot suggestion) is accepted. */
export interface CompletionAcceptEvent extends BaseEvent {
  eventType: "completionAccept";
  /** Model that produced the completion, if available. */
  modelName: string;
  /** Round-trip latency in milliseconds, `0` when unknown. */
  latencyMs: number;
  /** `true` when the user accepted only part of the suggestion. */
  isPartialAccept: boolean;
  /** Number of characters in the accepted completion text. */
  acceptedCharacters: number;
  /** Paths of other files that were visible/open at the time (workspace context). */
  openEditorPaths: string[];
}

/** Emitted on `window.onDidChangeActiveTextEditor`. */
export interface EditorSwitchEvent extends BaseEvent {
  eventType: "editorSwitch";
  /** `fsPath` of the newly active file, or `""` for untitled/virtual documents. */
  filePath: string;
}

/**
 * Calculate the Copilot efficiency metric for a method / region.
 *
 * ```
 * Efficiency = Accepted_Characters / Total_Characters_in_Method
 * ```
 *
 * Returns a value in `[0, 1]` (or `0` when `totalCharacters` is non-positive).
 */
export function calculateEfficiency(acceptedCharacters: number, totalCharacters: number): number {
  if (totalCharacters <= 0) {
    return 0;
  }
  return Math.min(acceptedCharacters / totalCharacters, 1);
}
