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
import type { TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AgentHostChat, AgentStep, FusionUsage, SessionDetailPayload } from "../../src/types";
import { elapsedMs } from "../../src/log/interventions";
import { fusionReconciliation } from "../../src/log/fusion";
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

function fusionUsageText(usage: FusionUsage): string {
  return `requests ${usage.requestCount?.toLocaleString() ?? "unavailable"} · input ${usage.inputTokens?.toLocaleString() ?? "unavailable"} · output ${usage.outputTokens?.toLocaleString() ?? "unavailable"} · cache read ${usage.cachedTokens?.toLocaleString() ?? "unavailable"} · cache write ${usage.cacheWriteTokens?.toLocaleString() ?? "unavailable"} · ${formatAiCredits(toAiCredits(usage.totalNanoAiu))} AI credits`;
}

function renderChildChats(chats: AgentHostChat[]): TemplateResult {
  return html`<ul>${chats.map((chat) => html`<li>${chat.title} · ${chat.origin === "tool" ? "Tool-created" : chat.origin === "user" ? "User-created" : "Origin unavailable"}${chat.children.length ? renderChildChats(chat.children) : nothing}</li>`)}</ul>`;
}

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
      ${selectedThread.agentHostChildChats !== undefined ? html`<p>Listed in the local VS Code Agent Host catalog · ${selectedThread.agentHostChildChats} child chats. The catalog does not establish where the conversation started.</p>` : nothing}
      ${selectedThread.agentHostChats?.length ? html`<section><h3>Child chats</h3>${renderChildChats(selectedThread.agentHostChats)}</section>` : nothing}
      ${
        selectedThread.interventions?.permissions.length
          ? html`<section>
        <h3>Permission confirmations</h3>
        <p>${selectedThread.interventions.permissions.filter((p) => p.decisionSource === "human_response" && p.responseRecorded).length} human responses · ${selectedThread.interventions.permissions.filter((p) => p.decisionSource === "host_policy" && p.responseRecorded).length} host policy decisions · ${selectedThread.interventions.permissions.filter((p) => !p.responseRecorded).length} without a response record</p>
        ${selectedThread.interventions.permissions.map(
          (p) => html`<div class="db-agent-step-row"><div class="db-agent-step-body">
          <strong>${p.kind ?? "Unknown target"}</strong>${p.toolName ? html` · ${p.toolName}` : nothing}
          <div>Decision source: ${p.responseRecorded ? (p.decisionSource === "human_response" ? "Human response" : p.decisionSource === "host_policy" ? "Host policy" : "Unknown") : "Not recorded"} · Result: ${p.responseRecorded ? (p.result ?? "Unknown") : "No response record"}</div>
          <div>Requested: ${p.requestedAt ? formatUsageDate(p.requestedAt) : "Unknown"} · Responded: ${p.respondedAt ? formatUsageDate(p.respondedAt) : "Unknown"}</div>
          <div>Elapsed from request to response: ${elapsedMs(p) === null ? "Unknown" : formatPause(elapsedMs(p)!)}</div>
        </div></div>`,
        )}
      </section>`
          : nothing
      }
      ${
        selectedThread.diagnostics?.compactions.length
          ? html`<section>
        <h3>Context compaction</h3>
        ${selectedThread.diagnostics.compactions.map(
          (item) => html`<div class="db-agent-step-row"><div class="db-agent-step-body">
          <strong>${item.timestamp ? formatUsageDate(item.timestamp) : "Time unavailable"}</strong> · ${item.trigger ?? "Unknown trigger"} · ${item.success === null ? "Result unavailable" : item.success ? "Succeeded" : "Failed"}
          <div>${item.before?.toLocaleString() ?? "Unavailable"} → ${item.after?.toLocaleString() ?? "Unavailable"} tokens</div>
        </div></div>`,
        )}
      </section>`
          : nothing
      }
      ${
        selectedThread.diagnostics?.subagents.length
          ? html`<section>
        <h3>Observed subagents</h3>
        <p>Parent identifiers are shown only when recorded; the execution surface is not known from these events.</p>
        ${selectedThread.diagnostics.subagents.map(
          (item) => html`<div class="db-agent-step-row"><div class="db-agent-step-body">
          <strong>${item.name}</strong> · ${item.model ?? "Model unavailable"} · ${item.durationMs === null ? "Duration unavailable" : formatPause(item.durationMs)}
          ${item.parentId ? html`<div>Parent: ${item.parentId}</div>` : nothing}
        </div></div>`,
        )}
      </section>`
          : nothing
      }
      ${
        selectedThread.fusionRuns?.length
          ? html`<section>
        <h3>Fusion execution breakdown</h3>
        <p>Observed phases explain part of the session accounting; they are not added to session totals. Cache read is reported as cachedTokens; it is not added to input tokens. Model verdicts do not indicate user acceptance.</p>
        ${selectedThread.fusionRuns.map(
          (run) => html`<div class="db-agent-step-row"><div class="db-agent-step-body">
          <strong>${run.mode ?? "Unknown mode"} / planned ${run.pattern ?? "unknown pattern"}</strong>
          <div>Planned: ${run.plan.map((p) => `${p.kind ?? "unknown"}${p.conditional ? " (conditional)" : ""}`).join(" → ") || "unavailable"}</div>
          <div>Elapsed: ${run.completed?.durationMs == null ? "unavailable" : formatPause(run.completed.durationMs)} · Phase / completion totals: ${fusionReconciliation(run)}</div>
          ${run.phases.map(
            (phase) => html`<div style="margin-top:8px">
            <strong>${phase.kind ?? "unknown phase"}</strong> (${phase.role ?? "unknown role"}) — ${phase.model ?? "unknown model"} · ${phase.status ?? "unknown status"}${phase.verdict ? ` · model verdict: ${phase.verdict}` : ""}
            <div>${phase.durationMs === null ? "Time unavailable" : formatPause(phase.durationMs)} · input ${phase.usage.inputTokens?.toLocaleString() ?? "unavailable"} · output ${phase.usage.outputTokens?.toLocaleString() ?? "unavailable"} · cache read ${phase.usage.cachedTokens?.toLocaleString() ?? "unavailable"} · cache write ${phase.usage.cacheWriteTokens?.toLocaleString() ?? "unavailable"} · ${formatAiCredits(toAiCredits(phase.usage.totalNanoAiu))} AI credits</div>
          </div>`,
          )}
          <div style="margin-top:8px">Final source model: ${run.phases.find((phase) => phase.phaseId === run.completed?.finalPhaseId)?.model ?? run.completed?.finalModel ?? "unavailable"}</div>
          <div>Completion: ${run.completed?.outcome ?? "not recorded"}. ${run.completed ? fusionUsageText(run.completed.usage) : "Completion totals unavailable"}</div>
          <div>Session accounting includes other usage and adjustments; direct reconciliation is unavailable.</div>
        </div></div>`,
        )}
      </section>`
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
