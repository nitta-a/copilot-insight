/**
 * ContextFreshnessMeter — Lit Web Component for displaying the AI context
 * freshness score, status, and refresh metadata.
 *
 * Usage:
 *   const el = document.createElement("copilot-freshness-meter") as ContextFreshnessMeter;
 *   el.freshness = freshness;
 *   el.refreshAnalysis = refreshAnalysis;
 *   container.appendChild(el);
 *
 * Properties:
 *   freshness       — ContextFreshness object (or null to clear the component).
 *   refreshAnalysis — array of refresh analysis entries.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { ContextFreshness, DashboardPayload } from "../../src/ui/dashboardMessages";
import { trunc } from "../dashboardUtils";

@customElement("copilot-freshness-meter")
export class ContextFreshnessMeter extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    h2 {
      font-size: 1.1em;
      margin: 0 0 12px;
    }
    .db-freshness-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 16px;
    }
    .db-freshness-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .db-freshness-status {
      font-weight: 700;
      font-size: 1em;
      opacity: 0.9;
    }
    .db-freshness-meter {
      height: 8px;
      background: var(--vscode-editor-background, #1e1e1e);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .db-freshness-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
      background: var(--vscode-charts-blue, #007acc);
    }
    .db-freshness-fill.fresh     { background: var(--vscode-charts-green,  #4ec9b0); }
    .db-freshness-fill.aging     { background: var(--vscode-charts-orange, #cca700); }
    .db-freshness-fill.exhausted { background: var(--vscode-charts-red,    #f14c4c); }
    .db-freshness-suggestion {
      font-size: 0.88em;
      opacity: 0.84;
      margin-bottom: 12px;
    }
    .db-freshness-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .db-freshness-meta-card {
      background: var(--vscode-editor-background, #1e1e1e);
      border-radius: 6px;
      padding: 8px 12px;
      flex: 1;
      min-width: 100px;
    }
    .db-freshness-meta-label {
      font-size: 0.74em;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    .db-freshness-meta-value {
      font-size: 0.92em;
      font-weight: 600;
    }
  `;

  @property({ type: Object }) freshness: ContextFreshness | null = null;
  @property({ type: Array }) refreshAnalysis: DashboardPayload["refreshAnalysis"] = [];

  private _metaCard(label: string, value: string, title = "") {
    return html`
      <div class="db-freshness-meta-card">
        <div class="db-freshness-meta-label">${label}</div>
        <div class="db-freshness-meta-value" title="${title}">${value}</div>
      </div>
    `;
  }

  render() {
    if (!this.freshness || this.refreshAnalysis.length === 0) {
      return nothing;
    }

    const freshness = this.freshness;
    const latestRefresh = this.refreshAnalysis.at(-1) ?? null;
    const score = Math.max(0, Math.min(100, freshness.score));

    const statusLabel = freshness.status === "fresh" ? "Fresh" : freshness.status === "aging" ? "Aging" : "Exhausted";
    const statusDetail =
      freshness.status === "fresh"
        ? "AI は絶好調"
        : freshness.status === "aging"
          ? "/compact を検討してください"
          : "セッションの再起動を推奨";
    const suggestion =
      freshness.suggestedAction === "none"
        ? "今はリフレッシュ不要です。"
        : freshness.suggestedAction === "compact"
          ? "次の大きなタスク前に /compact を挟むのが妥当です。"
          : "新しいセッションを開始した方が回復しやすい状態です。";

    const latestRoi =
      freshness.latestRefreshRoi !== null ? `+${(freshness.latestRefreshRoi * 100).toFixed(1)}%` : "N/A";
    const latestRecovery =
      freshness.latestRecoveryDelta !== null ? `${freshness.latestRecoveryDelta.toFixed(1)} pt` : "N/A";
    const latestEventType = latestRefresh ? latestRefresh.event.type : "memory";
    const latestTimestamp = latestRefresh ? new Date(latestRefresh.event.timestamp).toLocaleString() : "";

    return html`
      <h2>🧠 Context Freshness</h2>
      <div class="db-freshness-card">
        <div class="db-freshness-header">
          <div>
            <div class="db-freshness-status">${statusLabel}</div>
            <div style="font-size:1.6em;font-weight:800;margin-top:2px">${score.toFixed(0)}%</div>
          </div>
          <div style="font-size:0.88em;opacity:0.8;text-align:right">${statusDetail}</div>
        </div>
        <div class="db-freshness-meter">
          <div
            class=${classMap({ "db-freshness-fill": true, [freshness.status]: true })}
            style=${styleMap({ width: `${score}%` })}
          ></div>
        </div>
        <div class="db-freshness-suggestion">${suggestion}</div>
        <div class="db-freshness-meta">
          ${this._metaCard("Current Session Actions", String(freshness.actionCount))}
          ${this._metaCard("Latest Refresh ROI", latestRoi)}
          ${this._metaCard("Recovery Delta", latestRecovery)}
          ${this._metaCard("Latest Boundary", trunc(latestEventType, 22), latestTimestamp)}
        </div>
      </div>
    `;
  }
}
