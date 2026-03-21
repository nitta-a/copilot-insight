/**
 * ThreadList — Web Component for displaying the list of agent session threads.
 *
 * Dispatches a `thread-select` CustomEvent (bubbles + composed) when a thread
 * row is clicked, carrying `detail: { threadId: string; sessionId: string }`.
 *
 * Usage:
 *   const el = document.createElement("copilot-thread-list") as ThreadList;
 *   el.data = { flat, selectedThreadId, selectedThreadSessionId, isBackgroundLoading, sessionLoadQueueLength };
 *   container.replaceChildren(el);
 *
 *   el.addEventListener("thread-select", (e) => {
 *     const { threadId, sessionId } = (e as CustomEvent<ThreadSelectDetail>).detail;
 *   });
 */

import type { SessionThreadSummary } from "../../src/types";

export interface ThreadListData {
  flat: Array<{ thread: SessionThreadSummary; sessionId: string }>;
  selectedThreadId: string;
  selectedThreadSessionId: string;
  isBackgroundLoading: boolean;
  sessionLoadQueueLength: number;
}

export interface ThreadSelectDetail {
  threadId: string;
  sessionId: string;
}

const SHADOW_STYLES = `
  :host {
    display: block;
  }
  .empty-panel {
    padding: 28px 20px;
    opacity: 0.7;
  }
  .thread-row {
    width: 100%;
    background: transparent;
    color: inherit;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 72%, transparent);
    text-align: left;
    padding: 12px;
    cursor: pointer;
    font: inherit;
  }
  .thread-row:hover { background: var(--vscode-list-hoverBackground); }
  .thread-row.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .thread-row-title { font-weight: 700; }
  .thread-row-subtext { margin-top: 4px; font-size: 0.8em; opacity: 0.68; }
  .thread-row-meta {
    margin-top: 4px;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.78em;
    opacity: 0.78;
  }
`;

/** Custom element that renders the list of agent session thread rows in Shadow DOM. */
export class ThreadList extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private _data: ThreadListData | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: ThreadListData) {
    this._data = value;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    const fragment = document.createDocumentFragment();

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    fragment.appendChild(style);

    if (!this._data || this._data.flat.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-panel";
      const isLoading =
        this._data && (this._data.isBackgroundLoading || this._data.sessionLoadQueueLength > 0);
      empty.textContent = isLoading ? "Loading threads\u2026" : "No threads with activity were detected.";
      fragment.appendChild(empty);
      this._shadow.replaceChildren(fragment);
      return;
    }

    const { flat, selectedThreadId, selectedThreadSessionId } = this._data;

    for (const { thread, sessionId } of flat) {
      const isActive = thread.threadId === selectedThreadId && sessionId === selectedThreadSessionId;

      const button = document.createElement("button");
      button.className = `thread-row${isActive ? " active" : ""}`;
      button.type = "button";

      const titleEl = document.createElement("div");
      titleEl.className = "thread-row-title";
      titleEl.textContent = `${thread.hasAutonomousRun ? "\uD83E\uDD16 " : ""}${thread.title}`;

      const subtextEl = document.createElement("div");
      subtextEl.className = "thread-row-subtext";
      subtextEl.textContent = new Date(thread.startedAt).toLocaleString();

      const metaEl = document.createElement("div");
      metaEl.className = "thread-row-meta";

      const stepsSpan = document.createElement("span");
      stepsSpan.textContent = `${thread.stepCount} steps`;

      const savedSpan = document.createElement("span");
      savedSpan.textContent = `${thread.estimatedMinutesSaved.toFixed(1)} min saved`;

      metaEl.appendChild(stepsSpan);
      metaEl.appendChild(savedSpan);

      button.appendChild(titleEl);
      button.appendChild(subtextEl);
      button.appendChild(metaEl);

      button.addEventListener("click", () => {
        this.dispatchEvent(
          new CustomEvent<ThreadSelectDetail>("thread-select", {
            detail: { threadId: thread.threadId, sessionId },
            bubbles: true,
            composed: true,
          }),
        );
      });

      fragment.appendChild(button);
    }

    this._shadow.replaceChildren(fragment);
  }
}

if (!customElements.get("copilot-thread-list")) {
  customElements.define("copilot-thread-list", ThreadList);
}
