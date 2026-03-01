import * as vscode from "vscode";
import type { CompletionAcceptEvent, EditorSwitchEvent, TextChangeEvent } from "./eventSchema";
import { EventStorage } from "./eventStorage";

/** Sliding-window duration for active-completion tracking (5 minutes in ms). */
const ACTIVE_WINDOW_MS = 5 * 60 * 1_000;

/**
 * An accepted inline completion held in the in-memory sliding-window map.
 * Keyed by `"${uri}:${lineNumber}"` for O(1) lookup during document changes.
 */
export interface ActiveCompletion {
  uri: string;
  lineNumber: number;
  /** `Date.now()` value at the time of acceptance, used for pruning. */
  acceptedAt: number;
  languageId: string;
}

/**
 * Phase 1 of the implementation roadmap: VS Code event listeners that capture
 * raw editing activity and persist structured events via {@link EventStorage}.
 *
 * Tracked events:
 * - `onDidChangeTextDocument`  → {@link TextChangeEvent}
 * - `window.onDidChangeActiveTextEditor` → {@link EditorSwitchEvent}
 * - Inline-completion acceptance (called from extension.ts) → {@link CompletionAcceptEvent}
 *
 * The tracker is intentionally **fire-and-forget**: event writes never block
 * the editor, and I/O errors are silently swallowed so that the extension
 * cannot degrade the user's editing experience.
 */
export class EventTracker implements vscode.Disposable {
  private readonly _storage: EventStorage;
  private readonly _sessionId: string;
  private readonly _disposables: vscode.Disposable[] = [];
  /**
   * Sliding-window map of recently accepted completions.
   * Key: `"${uri}:${lineNumber}"` — enables O(1) lookup and invalidation in
   * the `onDidChangeTextDocument` hot path.
   */
  private readonly _activeCompletions = new Map<string, ActiveCompletion>();

  /**
   * @param context  The extension context, used for `globalStorageUri` and
   *   session identification.
   */
  constructor(context: vscode.ExtensionContext) {
    this._storage = new EventStorage(context.globalStorageUri.fsPath);

    // Derive a short session id from the log URI path (last directory segment).
    const logPath = context.logUri.fsPath;
    this._sessionId = logPath.split(/[\\/]/).pop() ?? "unknown";

    // --- onDidChangeTextDocument ---
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        // Skip output-channel and other non-file documents.
        if (e.document.uri.scheme !== "file" && e.document.uri.scheme !== "untitled") {
          return;
        }
        // Hot path: single pass over content changes.
        // O(1) map invalidation (survival check) is merged with char counting
        // so there is no extra iteration cost.
        const docUri = e.document.uri.toString();
        let charsAdded = 0;
        let charsDeleted = 0;
        for (const change of e.contentChanges) {
          // Invalidate any active completion whose line was just modified.
          this._activeCompletions.delete(`${docUri}:${change.range.start.line}`);
          charsAdded += change.text.length;
          charsDeleted += change.rangeLength;
        }
        if (charsAdded === 0 && charsDeleted === 0) {
          return;
        }
        const event: TextChangeEvent = {
          sessionId: this._sessionId,
          timestamp: new Date().toISOString(),
          eventType: "textChange",
          languageId: e.document.languageId,
          charsAdded,
          charsDeleted,
        };
        void this._storage.append(event);
      }),
    );

    // --- onDidChangeActiveTextEditor ---
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const event: EditorSwitchEvent = {
          sessionId: this._sessionId,
          timestamp: new Date().toISOString(),
          eventType: "editorSwitch",
          languageId: editor?.document.languageId ?? "",
          filePath: editor?.document.uri.fsPath ?? "",
        };
        void this._storage.append(event);
      }),
    );
  }

  /**
   * Record an inline-completion acceptance event.
   *
   * Call this from the acceptance-tracking command in `extension.ts` (or from
   * `InlineCompletionTracker`) so that the accepted completion is persisted
   * alongside contextual metadata.
   *
   * Returns a `Promise<void>` that resolves when the event has been written to
   * disk, allowing callers to await it when ordering guarantees are needed.
   */
  recordCompletionAccept(options: {
    languageId: string;
    acceptedText: string;
    modelName?: string;
    latencyMs?: number;
    isPartialAccept?: boolean;
  }): Promise<void> {
    const openPaths = vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath).filter(Boolean);

    const event: CompletionAcceptEvent = {
      sessionId: this._sessionId,
      timestamp: new Date().toISOString(),
      eventType: "completionAccept",
      languageId: options.languageId,
      modelName: options.modelName ?? "",
      latencyMs: options.latencyMs ?? 0,
      isPartialAccept: options.isPartialAccept ?? false,
      acceptedCharacters: options.acceptedText.length,
      openEditorPaths: openPaths,
    };
    return this._storage.append(event);
  }

  /** Access the underlying storage (e.g. for queries). */
  get storage(): EventStorage {
    return this._storage;
  }

  /**
   * Register a just-accepted inline completion in the sliding-window map.
   *
   * Should be called (e.g. from `extension.ts`) immediately after an inline
   * completion acceptance is confirmed, supplying the document URI and the
   * line where the completion was inserted.
   *
   * @param uri         String form of the document URI (e.g. `document.uri.toString()`).
   * @param lineNumber  Zero-based line index of the accepted completion.
   * @param languageId  VS Code language ID of the document.
   * @param nowMs       Current time in milliseconds; defaults to `Date.now()`.
   *                    Supply an explicit value in tests to avoid wall-clock dependency.
   */
  trackActiveCompletion(uri: string, lineNumber: number, languageId: string, nowMs = Date.now()): void {
    const key = `${uri}:${lineNumber}`;
    this._activeCompletions.set(key, { uri, lineNumber, acceptedAt: nowMs, languageId });
    this.pruneActiveCompletions(nowMs);
  }

  /**
   * Remove completions older than 5 minutes from the sliding-window map.
   *
   * Called automatically by {@link trackActiveCompletion}.  May also be
   * invoked by an external periodic timer to keep the map lean even when no
   * new completions are accepted.
   *
   * @param nowMs  Current time in milliseconds; defaults to `Date.now()`.
   */
  pruneActiveCompletions(nowMs = Date.now()): void {
    const cutoff = nowMs - ACTIVE_WINDOW_MS;
    const staleKeys: string[] = [];
    for (const [key, completion] of this._activeCompletions) {
      if (completion.acceptedAt < cutoff) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) {
      this._activeCompletions.delete(key);
    }
  }

  /**
   * O(1) lookup of an active completion by document URI and line number.
   *
   * Returns `undefined` when no completion is currently tracked at that
   * location (either because none was accepted there, or because it was
   * invalidated by a subsequent edit or pruned by the sliding window).
   */
  lookupActiveCompletion(uri: string, lineNumber: number): ActiveCompletion | undefined {
    return this._activeCompletions.get(`${uri}:${lineNumber}`);
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
    this._storage.dispose();
  }
}
