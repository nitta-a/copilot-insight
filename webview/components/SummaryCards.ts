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
import { trunc } from "../dashboardUtils";

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
      s.topPlanModel && s.topPlanModelCount > 0
        ? `${s.topPlanModelCount} plan & agent calls`
        : "no plan or agent data";

    return html`
      <copilot-stat-card
        show-download
        .value=${trueRateStr}
        label="True Acceptance Rate"
        highlight="blue"
        .subtext=${"vs " + s.acceptanceRate.toFixed(1) + "% raw"}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${totalHours + " hours"}
        label="Estimated Time Saved"
        highlight="blue"
        .subtext=${roiDetail}
        .title=${sourceDetail}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${trunc(topChatModelStr, 18)}
        label="Top Chat Model"
        highlight="blue"
        .subtext=${topChatModelDetail}
        .title=${topChatModelStr}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${trunc(topAskModelStr, 18)}
        label="Top Ask Model"
        highlight="blue"
        .subtext=${topAskModelDetail}
        .title=${topAskModelStr}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${trunc(topPlanModelStr, 18)}
        label="Top Plan Model"
        highlight="blue"
        .subtext=${topPlanModelDetail}
        .title=${topPlanModelStr}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${String(s.totalShown)}
        label="Suggestions Shown"
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${String(s.totalAccepted)}
        label="Suggestions Accepted"
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${s.acceptanceRate.toFixed(1) + "%"}
        label="Raw Acceptance Rate"
      ></copilot-stat-card>
      ${this._renderTokenCards(s.tokenStats)}
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
        label="Total Tokens Used"
        .subtext=${promptK + "k prompt / " + completionK + "k completion"}
      ></copilot-stat-card>
      <copilot-stat-card
        show-download
        .value=${topModelStr}
        label="Top Model (Tokens)"
        .subtext=${topModelDetail}
      ></copilot-stat-card>
    `;
  }
}
