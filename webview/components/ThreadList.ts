/**
 * ThreadList — Lit Web Component for displaying a list of Copilot session
 * threads with selection state.
 *
 * Usage:
 *   const el = document.createElement("copilot-thread-list") as ThreadList;
 *   el.flat = flat;
 *   el.selectedThreadId = selectedThreadId;
 *   el.selectedSessionId = selectedSessionId;
 *   el.isLoading = isLoading;
 *   el.queueLength = queueLen;
 *   container.appendChild(el);
 *
 * Fired events:
 *   thread-select — dispatched with { bubbles: true, composed: true } when the
 *                   user clicks a thread row.
 *                   detail: { threadId: string; sessionId: string }
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { SessionThreadSummary } from "../../src/types";

export interface ThreadSelectDetail {
  threadId: string;
  sessionId: string;
}

@customElement("copilot-thread-list")
export class ThreadList extends LitElement {
  static styles = css`
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

  @property({ type: Array }) flat: Array<{ thread: SessionThreadSummary; sessionId: string }> = [];
  @property({ type: String }) selectedThreadId = "";
  @property({ type: String }) selectedSessionId = "";
  @property({ type: Boolean }) isLoading = false;
  @property({ type: Number }) queueLength = 0;

  private _handleSelect(threadId: string, sessionId: string): void {
    if (threadId) {
      this.dispatchEvent(
        new CustomEvent<ThreadSelectDetail>("thread-select", {
          bubbles: true,
          composed: true,
          detail: { threadId, sessionId },
        }),
      );
    }
  }

  render() {
    if (this.flat.length === 0) {
      const msg =
        this.isLoading || this.queueLength > 0
          ? "Loading threads\u2026"
          : "No threads with activity were detected.";
      return html`<div class="db-empty-panel">${msg}</div>`;
    }

    return html`
      ${this.flat.map(({ thread, sessionId }) => {
        const isActive = thread.threadId === this.selectedThreadId && sessionId === this.selectedSessionId;
        const rowClasses = { "db-thread-row": true, active: isActive };
        return html`
          <button
            class=${classMap(rowClasses)}
            @click=${() => this._handleSelect(thread.threadId, sessionId)}
          >
            <div class="db-thread-row-title">
              ${thread.hasAutonomousRun ? "\uD83E\uDD16 " : ""}${thread.title}
            </div>
            <div class="db-thread-row-subtext">
              ${new Date(thread.startedAt).toLocaleString()}
            </div>
            <div class="db-thread-row-meta">
              <span>${thread.stepCount} steps</span>
              <span>${thread.estimatedMinutesSaved.toFixed(1)} min saved</span>
            </div>
          </button>
        `;
      })}
    `;
  }
}
