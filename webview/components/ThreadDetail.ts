/**
 * ThreadDetail — Lit Web Component for rendering the step timeline of a
 * selected Copilot session thread.
 *
 * Uses light DOM so that global dashboard CSS classes apply directly.
 *
 * Usage:
 *   const el = document.createElement("copilot-thread-detail") as ThreadDetail;
 *   el.detail = sessionDetailPayload;
 *   el.selectedThreadId = threadId;
 *   container.appendChild(el);
 *
 * Properties:
 *   detail           — SessionDetailPayload (or null when not yet loaded).
 *   selectedThreadId — thread ID to display; falls back to first thread with activity.
 *
 * Exports:
 *   getSelectableThreadsSorted — utility used by dashboard.ts to sync
 *                                selectedThreadId state after fallback.
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AgentStep, SessionDetailPayload } from "../../src/types";
import {
  actorBadgeClass,
  actorIcon,
  actorLabel,
  agentStepBadgeClass,
  formatPause,
  formatPhaseLabel,
  formatStepDetail,
} from "../dashboardUtils";

/** Sort and filter threads to those with activity, newest first. */
export function getSelectableThreadsSorted(threads: SessionDetailPayload["threads"]): SessionDetailPayload["threads"] {
  return [...threads].filter((t) => t.stepCount > 0).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

@customElement("copilot-thread-detail")
export class ThreadDetail extends LitElement {
  override createRenderRoot() {
    // Light DOM — relies on global dashboard CSS classes.
    return this;
  }

  @property({ type: Object }) detail: SessionDetailPayload | null = null;
  @property({ type: String }) selectedThreadId = "";

  render() {
    if (!this.detail || !this.selectedThreadId) {
      return html`<div class="db-empty-panel">Select a thread to inspect its timeline.</div>`;
    }

    const sortedThreads = getSelectableThreadsSorted(this.detail.threads);
    const selectedThread = sortedThreads.find((t) => t.threadId === this.selectedThreadId) ?? sortedThreads[0] ?? null;

    if (!selectedThread) {
      return html`<div class="db-empty-panel">No thread detail with activity is available.</div>`;
    }

    const steps = this.detail.stepsByThread[selectedThread.threadId] ?? [];
    const longestPause = steps.reduce((max, step) => Math.max(max, step.durationMs ?? 0), 0);

    const stepsContent =
      steps.length > 0
        ? steps.map((step: AgentStep) => this._renderStep(step, longestPause))
        : html`<div class="db-empty-panel">No timeline signals were recorded for this thread.</div>`;

    return html`
      <div class="db-thread-detail-header-block">
        <div>
          <strong>${selectedThread.title}</strong>
          <div style="margin-top:4px;font-size:0.84em;opacity:0.74">
            ${new Date(selectedThread.startedAt).toLocaleString()}
          </div>
        </div>
        <div class="db-thread-detail-metrics">
          <span class="db-tag">${selectedThread.stepCount} steps</span>
          <span class="db-tag">${selectedThread.estimatedMinutesSaved.toFixed(1)} min saved</span>
          ${
            selectedThread.longestPauseMs > 0
              ? html`<span class="db-tag">Longest wait ${formatPause(selectedThread.longestPauseMs)}</span>`
              : nothing
          }
          ${selectedThread.hasAutonomousRun ? html`<span class="db-badge">🤖 Autonomous</span>` : nothing}
        </div>
      </div>
      <div class="db-agent-step-timeline">${stepsContent}</div>
    `;
  }

  private _renderStep(step: AgentStep, longestPause: number) {
    const pause = step.durationMs ?? 0;
    const isLongest = pause > 0 && pause === longestPause;

    const durationChip =
      step.durationMs !== undefined
        ? html`<span class="db-agent-step-chip db-agent-step-chip-duration${isLongest ? " longest" : ""}">
            ⏱ ${formatPause(step.durationMs)}
          </span>`
        : html`<span class="db-agent-step-chip db-agent-step-chip-duration pending">Current</span>`;

    const pauseSeparator =
      step.isSignificantPause && step.durationMs !== undefined
        ? html`<div class="db-agent-step-separator">(Significant Pause)</div>`
        : nothing;

    return html`
      <div
        class="db-agent-step-row${isLongest ? " longest-pause" : ""}${step.isSignificantPause ? " significant-pause" : ""}"
      >
        <div class="db-agent-step-body${step.isFallback ? " fallback" : ""}">
          <div class="db-agent-step-meta">
            <span>${new Date(step.timestamp).toLocaleString()}</span>
          </div>
          <div class="db-agent-step-chip-row">
            <span class="db-agent-step-chip db-agent-step-chip-actor ${actorBadgeClass(step.actor)}">
              <span>${actorIcon(step.actor)}</span><span>${actorLabel(step.actor)}</span>
            </span>
            <span class="db-agent-step-badge ${agentStepBadgeClass(step.label)}">${step.label}</span>
            ${durationChip}
          </div>
          <div class="db-agent-step-detail">${formatStepDetail(step.detail, step.label)}</div>
          <div class="db-agent-step-submeta">
            <span>${formatPhaseLabel(step.phase)}</span><span>${step.rawIntent || "signal"}</span>
          </div>
          ${isLongest ? html`<div class="db-agent-step-duration-note">Longest wait</div>` : nothing}
          ${pauseSeparator}
        </div>
      </div>
    `;
  }
}
