/**
 * SummaryCards — Lit Web Component that renders the summary KPI stat-card grid.
 *
 * Replaces the `buildSummaryCardsHtml` string-builder in `htmlBuilders.ts` with
 * a reactive Lit component so that HTML injection via `innerHTML` is avoided.
 *
 * Usage:
 *   const el = document.createElement("copilot-summary-cards") as SummaryCards;
 *   el.summary = payload.summary;
 *   container.appendChild(el);
 *
 * Properties:
 *   summary — `DashboardPayload["summary"]` data object.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { DashboardPayload } from "../../src/ui/dashboardMessages";
import { formatAiCredits, trunc } from "../dashboardUtils";

@customElement("copilot-summary-cards")
export class SummaryCards extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
  `;

  @property({ type: Object }) summary: DashboardPayload["summary"] | null = null;

  render() {
    const s = this.summary;
    if (!s) {
      return nothing;
    }

    const trueRateStr = s.trueAcceptanceRate !== null ? `${s.trueAcceptanceRate.toFixed(1)}%` : "—";
    const totalHours = (s.totalMinutesSaved.total / 60).toFixed(1);
    const typingHours = (s.typingMinutesSaved / 60).toFixed(1);
    const agenticHours = (s.agenticMinutesSaved / 60).toFixed(1);
    const editorHours = (s.totalMinutesSaved.editor / 60).toFixed(1);
    const cliHours = (s.totalMinutesSaved.cli / 60).toFixed(1);
    const roiDetail =
      s.agenticMinutesSaved > 0 ? `Typing: ${typingHours}h + AI: ${agenticHours}h` : `Typing: ${typingHours}h`;
    const sourceDetail = `Editor: ${editorHours}h / CLI: ${cliHours}h`;

    const topChatModelStr = s.topChatModel ?? "—";
    const topChatModelDetail =
      s.topChatModel && s.topChatModelCount > 0 ? `${s.topChatModelCount} requests` : "no chat model data";

    const topAskModelStr = s.topAskModel ?? "—";
    const topAskModelDetail =
      s.topAskModel && s.topAskModelCount > 0 ? `${s.topAskModelCount} requests` : "no ask model data";

    const topPlanModelStr = s.topPlanModel ?? "—";
    const topPlanModelDetail =
      s.topPlanModel && s.topPlanModelCount > 0 ? `${s.topPlanModelCount} plan & agent calls` : "no plan or agent data";

    return html`
      <copilot-stat-card
        show-download
        .value=${trueRateStr}
        icon="🎯"
        label="True Acceptance Rate"
        highlight="blue"
        .subtext=${s.totalShown > 0 ? "vs " + s.acceptanceRate.toFixed(1) + "% raw" : "No recorded suggestions"}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${totalHours + " hours"}
        icon="⏱️"
        label="Estimated Time Saved"
        highlight="blue"
        .subtext=${roiDetail}
        .title=${sourceDetail}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${trunc(topChatModelStr, 18)}
        icon="💬"
        label="Top Chat Model"
        highlight="blue"
        .subtext=${topChatModelDetail}
        .title=${topChatModelStr}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${trunc(topAskModelStr, 18)}
        icon="❓"
        label="Top Ask Model"
        highlight="blue"
        .subtext=${topAskModelDetail}
        .title=${topAskModelStr}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${trunc(topPlanModelStr, 18)}
        icon="📋"
        label="Top Plan Model"
        highlight="blue"
        .subtext=${topPlanModelDetail}
        .title=${topPlanModelStr}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${String(s.totalShown)}
        icon="👀"
        label="Suggestions Shown"
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${String(s.totalAccepted)}
        icon="✅"
        label="Suggestions Accepted"
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${s.totalShown > 0 ? s.acceptanceRate.toFixed(1) + "%" : "—"}
        icon="📊"
        label="Raw Acceptance Rate"
      ></copilot-stat-card>
      ${this._renderTokenCards(s.tokenStats)}
      ${this._renderCliUsageCards(s.cliUsageStats)}
    `;
  }

  private _renderCliUsageCards(cliUsageStats: DashboardPayload["summary"]["cliUsageStats"]) {
    if (!cliUsageStats) {
      return nothing;
    }

    const topModel = cliUsageStats.topModels[0];
    const modelDetails = cliUsageStats.topModels
      .map((model) => `${model.model}: ${formatAiCredits(model.aiCredits)} AI credits`)
      .join("\n");

    return html`
      <copilot-stat-card
        show-download
        .value=${formatAiCredits(cliUsageStats.totalAiCredits)}
        icon="💳"
        label="Copilot CLI AI Credits"
        .subtext=${"Local sessions only; not account-wide billing"}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${cliUsageStats.totalTokens.toLocaleString()}
        icon="🪙"
        label="Copilot CLI Tokens"
        .subtext=${`${cliUsageStats.inputTokens.toLocaleString()} input / ${cliUsageStats.outputTokens.toLocaleString()} output`}
        .title=${`${cliUsageStats.cacheReadTokens.toLocaleString()} cache-read / ${cliUsageStats.cacheWriteTokens.toLocaleString()} cache-write tokens`}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${topModel ? trunc(topModel.model, 18) : "—"}
        icon="🏆"
        label="Top CLI Model (Credits)"
        .subtext=${topModel ? `${formatAiCredits(topModel.aiCredits)} AI credits` : "no model usage data"}
        .title=${modelDetails || "No per-model usage data"}
      ></copilot-stat-card>
    `;
  }

  private _renderTokenCards(tokenStats: DashboardPayload["summary"]["tokenStats"]) {
    if (!tokenStats) {
      return nothing;
    }
    const totalK = (tokenStats.totalTokens / 1000).toFixed(1);
    const promptK = (tokenStats.totalPromptTokens / 1000).toFixed(1);
    const completionK = (tokenStats.totalCompletionTokens / 1000).toFixed(1);
    const topModel = tokenStats.topModelsByTokens[0];
    const topModelStr = topModel ? trunc(topModel.model, 18) : "—";
    const topModelDetail = topModel
      ? `${((topModel.promptTokens + topModel.completionTokens) / 1000).toFixed(1)}k tokens`
      : "no data";
    return html`
      <copilot-stat-card
        show-download
        .value=${totalK + "k"}
        icon="🪙"
        label="Total Tokens Used"
        .subtext=${promptK + "k prompt / " + completionK + "k completion"}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${topModelStr}
        icon="🏆"
        label="Top Model (Tokens)"
        .subtext=${topModelDetail}
      ></copilot-stat-card>
    `;
  }
}
