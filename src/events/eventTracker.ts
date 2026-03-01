import * as vscode from "vscode";
import type { CompletionAcceptEvent, EditorSwitchEvent, TextChangeEvent } from "./eventSchema";
import { EventStorage } from "./eventStorage";

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

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
    this._storage.dispose();
  }
}
