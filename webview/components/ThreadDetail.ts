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
import { toAiCredits } from "../../src/utils";
import {
  actorBadgeClass,
  actorIcon,
  actorLabel,
  agentStepBadgeClass,
  formatPause,
  formatPhaseLabel,
  formatStepDetail,
  formatAiCredits,
  formatUsageDate,
} from "../dashboardUtils";

/** Sort and filter threads to those with activity, newest first. */
export function getSelectableThreadsSorted(threads: SessionDetailPayload["threads"]): SessionDetailPayload["threads"] {
  return [...threads]
    .filter((t) => t.stepCount > 0 || t.usage)
    .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
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
            ${formatUsageDate(selectedThread.startedAt)}
          </div>
        </div>
        <div class="db-thread-detail-metrics">
          <span class="db-tag">${selectedThread.stepCount} ${selectedThread.usageSource === "cli" ? "prompts" : "steps"}</span>
          ${
            selectedThread.usage
              ? html`<span class="db-tag">Total: ${formatAiCredits(toAiCredits(selectedThread.usage.totalNanoAiu))} AI credits</span>
                <span class="db-tag">${selectedThread.usage.inputTokens.toLocaleString()} input tokens</span>
                <span class="db-tag">${selectedThread.usage.outputTokens.toLocaleString()} output tokens</span>`
              : html`<span class="db-tag">${selectedThread.estimatedMinutesSaved.toFixed(1)} min saved</span>
                <span class="db-tag">AI credits: unavailable</span>`
          }
          ${
            selectedThread.longestPauseMs > 0
              ? html`<span class="db-tag">Longest wait ${formatPause(selectedThread.longestPauseMs)}</span>`
              : nothing
          }
          ${selectedThread.hasAutonomousRun ? html`<span class="db-badge">🤖 Autonomous</span>` : nothing}
        </div>
      </div>
      ${
        selectedThread.usageSource === "cli"
          ? html`<p style="font-size:0.85em;opacity:0.8">Copilot CLI / SDK conversation total.
            Prompt usage below is based on model-call records until the next prompt.
            Cumulative accounting adjustments or calls without an associated prompt are included only in the thread total.
            Credits are usage units, not an account-wide currency bill.</p>`
          : nothing
      }
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
        : step.usage
          ? nothing
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
            <span>${formatUsageDate(step.timestamp)}</span>
          </div>
          <div class="db-agent-step-chip-row">
            <span class="db-agent-step-chip db-agent-step-chip-actor ${actorBadgeClass(step.actor)}">
              <span>${actorIcon(step.actor)}</span><span>${actorLabel(step.actor)}</span>
            </span>
            <span class="db-agent-step-badge ${agentStepBadgeClass(step.label)}">${step.label}</span>
            ${durationChip}
          </div>
          <div class="db-agent-step-detail">${formatStepDetail(step.detail, step.label)}</div>
          ${
            step.usage
              ? html`<div class="db-agent-step-submeta">
                <span>${formatAiCredits(toAiCredits(step.usage.totalNanoAiu))} AI credits</span>
                <span>${step.usage.inputTokens.toLocaleString()} input / ${step.usage.outputTokens.toLocaleString()} output tokens</span>
              </div>`
              : nothing
          }
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
