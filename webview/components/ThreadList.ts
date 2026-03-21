/**
 * ThreadList — Web Component (Custom Element) for displaying a list of
 * Copilot session threads with selection state.
 *
 * Usage:
 *   const el = document.createElement("copilot-thread-list") as ThreadList;
 *   el.setData(flat, selectedThreadId, selectedSessionId, isLoading, queueLen);
 *   container.appendChild(el);
 *
 * Fired events:
 *   thread-select — dispatched with { bubbles: true, composed: true } when the
 *                   user clicks a thread row.
 *                   detail: { threadId: string; sessionId: string }
 */

import type { SessionThreadSummary } from "../../src/types";

export interface ThreadSelectDetail {
  threadId: string;
  sessionId: string;
}

const SHADOW_STYLES = `
  :host {
    display: block;
  }
  .db-empty-panel {
    opacity: 0.6;
    padding: 12px;
    font-size: 0.9em;
  }
  .db-thread-row {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editor-inactiveSelectionBackground));
    padding: 10px 12px;
    cursor: pointer;
    color: var(--vscode-foreground);
    box-sizing: border-box;
  }
  .db-thread-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
  }
  .db-thread-row.active {
    background: var(--vscode-list-activeSelectionBackground, rgba(0,122,204,0.2));
    border-left: 3px solid var(--vscode-charts-blue, #007acc);
  }
  .db-thread-row-title {
    font-size: 0.9em;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .db-thread-row-subtext {
    font-size: 0.76em;
    opacity: 0.65;
    margin-top: 2px;
  }
  .db-thread-row-meta {
    display: flex;
    gap: 8px;
    font-size: 0.76em;
    opacity: 0.7;
    margin-top: 4px;
  }
`;

export class ThreadList extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private readonly _content: HTMLDivElement;
  private _flat: Array<{ thread: SessionThreadSummary; sessionId: string }> = [];
  private _selectedThreadId = "";
  private _selectedSessionId = "";
  private _isLoading = false;
  private _queueLength = 0;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    this._content = document.createElement("div");
    this._shadow.append(style, this._content);
    // Event delegation: one listener on the content container handles all button clicks.
    this._content.addEventListener("click", (ev: Event) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>(".db-thread-row");
      if (!btn) {
        return;
      }
      const threadId = btn.dataset["threadId"] ?? "";
      const sessionId = btn.dataset["sessionId"] ?? "";
      if (threadId) {
        this.dispatchEvent(
          new CustomEvent<ThreadSelectDetail>("thread-select", {
            bubbles: true,
            composed: true,
            detail: { threadId, sessionId },
          }),
        );
      }
    });
    this._render();
  }

  setData(
    flat: Array<{ thread: SessionThreadSummary; sessionId: string }>,
    selectedThreadId: string,
    selectedSessionId: string,
    isLoading: boolean,
    queueLength: number,
  ): void {
    this._flat = flat;
    this._selectedThreadId = selectedThreadId;
    this._selectedSessionId = selectedSessionId;
    this._isLoading = isLoading;
    this._queueLength = queueLength;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    this._content.replaceChildren();

    if (this._flat.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-empty-panel";
      empty.textContent =
        this._isLoading || this._queueLength > 0
          ? "Loading threads\u2026"
          : "No threads with activity were detected.";
      this._content.appendChild(empty);
      return;
    }

    for (const { thread, sessionId } of this._flat) {
      const isActive = thread.threadId === this._selectedThreadId && sessionId === this._selectedSessionId;
      const btn = document.createElement("button");
      btn.className = `db-thread-row${isActive ? " active" : ""}`;
      btn.dataset["threadId"] = thread.threadId;
      btn.dataset["sessionId"] = sessionId;

      const titleEl = document.createElement("div");
      titleEl.className = "db-thread-row-title";
      titleEl.textContent = `${thread.hasAutonomousRun ? "\uD83E\uDD16 " : ""}${thread.title}`;

      const subtextEl = document.createElement("div");
      subtextEl.className = "db-thread-row-subtext";
      subtextEl.textContent = new Date(thread.startedAt).toLocaleString();

      const metaEl = document.createElement("div");
      metaEl.className = "db-thread-row-meta";
      const stepsSpan = document.createElement("span");
      stepsSpan.textContent = `${thread.stepCount} steps`;
      const savedSpan = document.createElement("span");
      savedSpan.textContent = `${thread.estimatedMinutesSaved.toFixed(1)} min saved`;
      metaEl.appendChild(stepsSpan);
      metaEl.appendChild(savedSpan);

      btn.appendChild(titleEl);
      btn.appendChild(subtextEl);
      btn.appendChild(metaEl);

      this._content.appendChild(btn);
    }
  }
}

if (!customElements.get("copilot-thread-list")) {
  customElements.define("copilot-thread-list", ThreadList);
}
