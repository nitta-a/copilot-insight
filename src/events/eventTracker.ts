import * as vscode from "vscode";
import type { DbWorkerClient } from "../worker/dbWorkerClient";
import type {
  CompletionAcceptEvent,
  EditorSwitchEvent,
  SessionActor,
  SessionPhase,
  SessionSignalEvent,
  SessionSignalType,
  TextChangeEvent,
  TrackedEvent,
} from "./eventSchema";
import { EventStorage } from "./eventStorage";

/** Number of buffered events that triggers an immediate batch ingest. */
const BATCH_SIZE = 10;
/** Interval (ms) for the periodic timer-based batch flush. */
const FLUSH_INTERVAL_MS = 5_000;
/** Interval (ms) for the periodic background compaction (1 hour). */
const COMPACT_INTERVAL_MS = 3_600_000;

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
 *
 * When a {@link DbWorkerClient} is supplied, events are also batched and
 * forwarded to the worker to reduce IPC overhead.  The batch is flushed when
 * it reaches {@link BATCH_SIZE} events **or** when the periodic timer fires,
 * whichever comes first.  On worker errors the buffer is retained so events
 * are retried on the next flush cycle.
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

  private _dbWorker: DbWorkerClient | undefined;
  private _buffer: TrackedEvent[] = [];
  private _flushTimer: ReturnType<typeof setInterval> | undefined;
  private _compactTimer: ReturnType<typeof setInterval> | undefined;
  private _isFlushing = false;

  /**
   * @param context  The extension context, used for `globalStorageUri` and
   *   session identification.
   * @param dbWorker  Optional worker client.  When supplied, events are batched
   *   and forwarded via `dbWorker.ingest()` to reduce IPC overhead.
   */
  constructor(context: vscode.ExtensionContext, dbWorker?: DbWorkerClient) {
    this._storage = new EventStorage(context.globalStorageUri.fsPath);
    this._dbWorker = dbWorker;

    // Derive a short session id from the log URI path (last directory segment).
    const logPath = context.logUri.fsPath;
    this._sessionId = logPath.split(/[\\/]/).pop() ?? "unknown";

    // Start the periodic flush timer only when a worker is wired up.
    if (this._dbWorker) {
      this._flushTimer = setInterval(() => {
        void this._flushBuffer();
      }, FLUSH_INTERVAL_MS);
      this._compactTimer = setInterval(() => {
        void this._dbWorker!.compact().catch(() => {
          // Compaction errors are non-fatal; silently ignore.
        });
      }, COMPACT_INTERVAL_MS);
    }

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
        void this._trackEvent(event);
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
        void this._trackEvent(event);
      }),
    );
  }

  /**
   * Persist an event to storage and, when a worker is configured and advanced
   * analysis is enabled, add it to the IPC buffer.  Triggers an immediate
   * flush when the buffer is full.
   *
   * Raw JSONL logging via {@link EventStorage} always runs regardless of the
   * `enableAdvancedAnalysis` setting.
   */
  private async _trackEvent(event: TrackedEvent): Promise<void> {
    await this._storage.append(event);
    if (!this._dbWorker) {
      return;
    }
    const analysisEnabled = vscode.workspace
      .getConfiguration("copilot-insight")
      .get<boolean>("enableAdvancedAnalysis", true);
    if (!analysisEnabled) {
      return;
    }
    this._buffer.push(event);
    if (this._buffer.length >= BATCH_SIZE) {
      await this._flushBuffer();
    }
  }

  /**
   * Send all buffered events to the worker in a single `ingest()` call.
   *
   * The buffer is cleared **only** on success so that a worker error leaves
   * events in place for the next retry cycle.
   */
  private async _flushBuffer(): Promise<void> {
    if (!this._dbWorker || this._buffer.length === 0 || this._isFlushing) {
      return;
    }
    this._isFlushing = true;
    const batch = this._buffer.slice();
    try {
      await this._dbWorker.ingest(batch);
      // Only clear the events that were successfully ingested.
      this._buffer = this._buffer.slice(batch.length);
    } catch {
      // Worker busy or failed — retain buffer for next retry.
    } finally {
      this._isFlushing = false;
    }
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
    return this._trackEvent(event);
  }

  recordSessionSignal(options: {
    languageId?: string;
    signalType: SessionSignalType;
    actor: SessionActor;
    phase: SessionPhase;
    intent: string;
    rawText: string;
    modelName?: string;
    latencyMs?: number;
    success?: boolean;
  }): Promise<void> {
    const event: SessionSignalEvent = {
      sessionId: this._sessionId,
      timestamp: new Date().toISOString(),
      eventType: "sessionSignal",
      languageId: options.languageId ?? "",
      signalType: options.signalType,
      actor: options.actor,
      phase: options.phase,
      intent: options.intent,
      rawText: options.rawText,
      modelName: options.modelName ?? "",
      latencyMs: options.latencyMs ?? 0,
      success: options.success ?? true,
    };
    return this._trackEvent(event);
  }

  /** Access the underlying storage (e.g. for queries). */
  get storage(): EventStorage {
    return this._storage;
  }

  /** Number of events currently waiting in the IPC buffer. */
  get bufferSize(): number {
    return this._buffer.length;
  }

  /**
   * Update the worker reference at runtime (e.g. when the master toggle is
   * re-enabled after being disabled).  Starts the flush timer if it has not
   * been started yet and a new worker is provided.
   */
  setDbWorker(worker: DbWorkerClient | undefined): void {
    this._dbWorker = worker;
    if (worker && this._flushTimer === undefined) {
      this._flushTimer = setInterval(() => {
        void this._flushBuffer();
      }, FLUSH_INTERVAL_MS);
    } else if (!worker && this._flushTimer !== undefined) {
      clearInterval(this._flushTimer);
      this._flushTimer = undefined;
    }
  }

  /** Flush any remaining buffered events and release all resources. */
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
    if (this._flushTimer !== undefined) {
      clearInterval(this._flushTimer);
      this._flushTimer = undefined;
    }
    if (this._compactTimer !== undefined) {
      clearInterval(this._compactTimer);
      this._compactTimer = undefined;
    }
    // Best-effort flush on deactivation; do not await to keep dispose() sync.
    if (this._buffer.length > 0 && this._dbWorker) {
      void this._flushBuffer();
    }
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
    this._storage.dispose();
  }
}
