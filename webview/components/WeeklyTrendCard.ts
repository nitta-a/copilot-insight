/**
 * WeeklyTrendCard — Lit Web Component for displaying the weekly acceptance rate
 * comparison (last week vs. this week).
 *
 * Usage:
 *   const el = document.createElement("copilot-weekly-trend");
 *   (el as WeeklyTrendCard).trendData = { thisWeek: …, lastWeek: …, rateDiff: … };
 *   container.appendChild(el);
 *
 * Properties:
 *   trendData — WeeklyTrendData object (or null to clear the component).
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { WeeklyTrendData } from "../../src/ui/dashboardMessages";

@customElement("copilot-weekly-trend")
export class WeeklyTrendCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    h2 {
      font-size: 1.1em;
      margin: 0 0 12px;
    }
    .trend-container {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .trend-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 14px 16px;
      flex: 1;
      min-width: 150px;
    }
    .trend-card h3 {
      margin: 0 0 10px;
      font-size: 0.92em;
      opacity: 0.8;
    }
    .trend-stat {
      display: flex;
      justify-content: space-between;
      font-size: 0.88em;
      padding: 3px 0;
    }
    .trend-diff {
      margin-top: 10px;
      font-size: 1.1em;
      font-weight: 700;
      text-align: center;
    }
    .trend-up   { color: var(--vscode-charts-green, #4ec9b0); }
    .trend-down { color: var(--vscode-charts-red,   #f14c4c); }
    .trend-neutral { opacity: 0.7; }
  `;

  @property({ type: Object }) trendData: WeeklyTrendData | null = null;

  private _statRow(label: string, value: string) {
    return html`
      <div class="trend-stat">
        <span>${label}</span>
        <span>${value}</span>
      </div>
    `;
  }

  render() {
    const trend = this.trendData;
    if (!trend || (trend.thisWeek.shown === 0 && trend.lastWeek.shown === 0)) {
      return nothing;
    }

    const thisRateStr = trend.thisWeek.shown > 0 ? `${trend.thisWeek.rate.toFixed(1)}%` : "—";
    const lastRateStr = trend.lastWeek.shown > 0 ? `${trend.lastWeek.rate.toFixed(1)}%` : "—";

    const showDiff = trend.thisWeek.shown > 0 && trend.lastWeek.shown > 0;
    const sign = trend.rateDiff > 0 ? "+" : "";
    const diffClasses = {
      "trend-diff": true,
      "trend-up": trend.rateDiff > 0,
      "trend-down": trend.rateDiff < 0,
      "trend-neutral": trend.rateDiff === 0,
    };
    const arrow = trend.rateDiff > 0 ? "↑" : trend.rateDiff < 0 ? "↓" : "→";

    return html`
      <h2>📈 Weekly Trend</h2>
      <div class="trend-container">
        <div class="trend-card">
          <h3>Last Week</h3>
          ${this._statRow("Shown", String(trend.lastWeek.shown))}
          ${this._statRow("Accepted", String(trend.lastWeek.accepted))}
          ${this._statRow("Rate", lastRateStr)}
          ${this._statRow("Chat", String(trend.lastWeek.chat))}
        </div>
        <div class="trend-card">
          <h3>This Week</h3>
          ${this._statRow("Shown", String(trend.thisWeek.shown))}
          ${this._statRow("Accepted", String(trend.thisWeek.accepted))}
          ${this._statRow("Rate", thisRateStr)}
          ${this._statRow("Chat", String(trend.thisWeek.chat))}
          ${showDiff
            ? html`<div class=${classMap(diffClasses)}>${arrow} ${sign}${trend.rateDiff.toFixed(1)}%</div>`
            : nothing}
        </div>
      </div>
    `;
  }
}
