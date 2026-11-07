import * as vscode from "vscode";
import type { DbWorkerClient } from "../worker/dbWorkerClient";
import type {
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

/**
 * Phase 1 of the implementation roadmap: VS Code event listeners that capture
 * raw editing activity and persist structured events via {@link EventStorage}.
 *
 * Tracked events:
 * - `onDidChangeTextDocument`  → {@link TextChangeEvent}
 * - `window.onDidChangeActiveTextEditor` → {@link EditorSwitchEvent}
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
        let charsAdded = 0;
        let charsDeleted = 0;
        for (const change of e.contentChanges) {
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
