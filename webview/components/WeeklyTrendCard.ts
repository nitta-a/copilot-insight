/**
 * WeeklyTrendCard — Web Component (Custom Element) for displaying the weekly
 * acceptance rate comparison (last week vs. this week).
 *
 * Usage:
 *   const el = document.createElement("copilot-weekly-trend");
 *   (el as WeeklyTrendCard).trendData = { thisWeek: …, lastWeek: …, rateDiff: … };
 *   container.appendChild(el);
 *
 * Setters:
 *   trendData — WeeklyTrendData object (or null to clear the component).
 */

import type { WeeklyTrendData } from "../../src/ui/dashboardMessages";

const SHADOW_STYLES = `
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

export class WeeklyTrendCard extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private readonly _content: HTMLDivElement;
  private _trendData: WeeklyTrendData | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    this._content = document.createElement("div");
    this._shadow.append(style, this._content);
    this._render();
  }

  set trendData(value: WeeklyTrendData | null) {
    this._trendData = value;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    this._content.replaceChildren();

    const trend = this._trendData;
    if (!trend || (trend.thisWeek.shown === 0 && trend.lastWeek.shown === 0)) {
      return;
    }

    const thisRateStr = trend.thisWeek.shown > 0 ? `${trend.thisWeek.rate.toFixed(1)}%` : "—";
    const lastRateStr = trend.lastWeek.shown > 0 ? `${trend.lastWeek.rate.toFixed(1)}%` : "—";

    const heading = document.createElement("h2");
    heading.textContent = "📈 Weekly Trend";
    this._content.appendChild(heading);

    const container = document.createElement("div");
    container.className = "trend-container";

    // Last week card
    const lastCard = document.createElement("div");
    lastCard.className = "trend-card";
    const lastH3 = document.createElement("h3");
    lastH3.textContent = "Last Week";
    lastCard.appendChild(lastH3);
    lastCard.appendChild(this._statRow("Shown", String(trend.lastWeek.shown)));
    lastCard.appendChild(this._statRow("Accepted", String(trend.lastWeek.accepted)));
    lastCard.appendChild(this._statRow("Rate", lastRateStr));
    lastCard.appendChild(this._statRow("Chat", String(trend.lastWeek.chat)));

    // This week card
    const thisCard = document.createElement("div");
    thisCard.className = "trend-card";
    const thisH3 = document.createElement("h3");
    thisH3.textContent = "This Week";
    thisCard.appendChild(thisH3);
    thisCard.appendChild(this._statRow("Shown", String(trend.thisWeek.shown)));
    thisCard.appendChild(this._statRow("Accepted", String(trend.thisWeek.accepted)));
    thisCard.appendChild(this._statRow("Rate", thisRateStr));
    thisCard.appendChild(this._statRow("Chat", String(trend.thisWeek.chat)));

    if (trend.thisWeek.shown > 0 && trend.lastWeek.shown > 0) {
      const sign = trend.rateDiff > 0 ? "+" : "";
      const cssClass = trend.rateDiff > 0 ? "trend-up" : trend.rateDiff < 0 ? "trend-down" : "trend-neutral";
      const arrow = trend.rateDiff > 0 ? "↑" : trend.rateDiff < 0 ? "↓" : "→";
      const diffEl = document.createElement("div");
      diffEl.className = `trend-diff ${cssClass}`;
      diffEl.textContent = `${arrow} ${sign}${trend.rateDiff.toFixed(1)}%`;
      thisCard.appendChild(diffEl);
    }

    container.appendChild(lastCard);
    container.appendChild(thisCard);
    this._content.appendChild(container);
  }

  private _statRow(label: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "trend-stat";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const valueSpan = document.createElement("span");
    valueSpan.textContent = value;
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    return row;
  }
}

if (!customElements.get("copilot-weekly-trend")) {
  customElements.define("copilot-weekly-trend", WeeklyTrendCard);
}
