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

    const topChatModelStr = s.topChatModel ?? "—";
    const topChatModelDetail =
      s.topChatModel && s.topChatModelCount > 0 ? `${s.topChatModelCount} requests` : "no chat model data";

    return html`
      <copilot-stat-card
        show-download
        .value=${trunc(topChatModelStr, 18)}
        icon="💬"
        label="Top Chat Model"
        highlight="blue"
        .subtext=${topChatModelDetail}
        .title=${topChatModelStr}
      ></copilot-stat-card>
      ${s.totalShown > 0 ? html`
        <copilot-stat-card show-download .value=${String(s.totalShown)} icon="👀" label="Suggestions Shown" subtext="Legacy VS Code logs"></copilot-stat-card>
      ` : nothing}
      ${s.totalShown > 0 || s.totalAccepted > 0 ? html`
        <copilot-stat-card show-download .value=${String(s.totalAccepted)} icon="✅" label="Suggestions Accepted" subtext="Legacy VS Code logs"></copilot-stat-card>
      ` : nothing}
      ${s.totalShown > 0 ? html`
        <copilot-stat-card show-download .value=${s.acceptanceRate.toFixed(1) + "%"} icon="📊" label="Raw Acceptance Rate" subtext="Legacy VS Code logs"></copilot-stat-card>
      ` : nothing}
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
