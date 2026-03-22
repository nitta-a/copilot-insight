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
 *   trendData    — WeeklyTrendData object (or null to clear the component).
 *   showDownload — when true, a 🖼️ download button is rendered that saves the
 *                  card as a PNG image.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { WeeklyTrendData } from "../../src/ui/dashboardMessages";
import { downloadAsPng } from "../utils/pngExport";

@customElement("copilot-weekly-trend")
export class WeeklyTrendCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
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
    .download-btn {
      position: absolute;
      top: 0;
      right: 0;
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      font-size: 0.9em;
      padding: 2px 4px;
      color: var(--vscode-foreground);
    }
    :host(:hover) .download-btn { opacity: 0.6; }
    .download-btn:hover { opacity: 1 !important; }
  `;

  @property({ type: Object }) trendData: WeeklyTrendData | null = null;
  @property({ type: Boolean }) showDownload = false;

  private _statRow(label: string, value: string) {
    return html`
      <div class="trend-stat">
        <span>${label}</span>
        <span>${value}</span>
      </div>
    `;
  }

  private async _handleDownload(): Promise<void> {
    await downloadAsPng(this, "copilot-weekly-trend.png");
  }

  render() {
    const trend = this.trendData;
    if (!trend || (trend.thisWeek.shown === 0 && trend.lastWeek.shown === 0)) {
      return nothing;
    }
    const { thisWeek, lastWeek, rateDiff } = trend;
    const thisRateStr = thisWeek.shown > 0 ? `${thisWeek.rate.toFixed(1)}%` : "—";
    const lastRateStr = lastWeek.shown > 0 ? `${lastWeek.rate.toFixed(1)}%` : "—";

    const showDiff = thisWeek.shown > 0 && lastWeek.shown > 0;
    const sign = rateDiff > 0 ? "+" : "";
    const diffClasses = {
      "trend-diff": true,
      "trend-up": rateDiff > 0,
      "trend-down": rateDiff < 0,
      "trend-neutral": rateDiff === 0,
    };
    const arrow = rateDiff > 0 ? "↑" : rateDiff < 0 ? "↓" : "→";

    return html`
      <h2>📈 Weekly Trend</h2>
      ${this.showDownload
        ? html`<button class="download-btn" title="Download as PNG" @click=${this._handleDownload}>🖼️</button>`
        : ""}
      <div class="trend-container">
        <div class="trend-card">
          <h3>Last Week</h3>
          ${this._statRow("Shown", String(lastWeek.shown))}
          ${this._statRow("Accepted", String(lastWeek.accepted))}
          ${this._statRow("Rate", lastRateStr)}
          ${this._statRow("Chat", String(lastWeek.chat))}
        </div>
        <div class="trend-card">
          <h3>This Week</h3>
          ${this._statRow("Shown", String(thisWeek.shown))}
          ${this._statRow("Accepted", String(thisWeek.accepted))}
          ${this._statRow("Rate", thisRateStr)}
          ${this._statRow("Chat", String(thisWeek.chat))}
          ${
            showDiff ? html`<div class=${classMap(diffClasses)}>${arrow} ${sign}${rateDiff.toFixed(1)}%</div>` : nothing
          }
        </div>
      </div>
    `;
  }
}
