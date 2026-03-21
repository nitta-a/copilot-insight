/**
 * WeeklyTrendCard — Web Component for displaying the Weekly Trend comparison.
 *
 * Usage:
 *   const el = document.createElement("copilot-weekly-trend") as WeeklyTrendCard;
 *   el.data = trend;
 *   container.replaceChildren(el);
 */

import type { WeeklyTrendData } from "../../src/ui/dashboardMessages";

const SHADOW_STYLES = `
  :host {
    display: block;
  }
  h2 {
    font-size: 1.1em;
    margin: 24px 0 10px;
  }
  .trend-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }
  @media (max-width: 600px) {
    .trend-container { grid-template-columns: 1fr; }
  }
  .trend-card {
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 6px;
    padding: 16px;
  }
  .trend-card h3 {
    font-size: 0.95em;
    margin: 0 0 12px 0;
    opacity: 0.8;
  }
  .trend-stat {
    display: flex;
    justify-content: space-between;
    margin: 4px 0;
    font-size: 0.85em;
  }
  .trend-diff {
    font-weight: bold;
    font-size: 1.1em;
    margin-top: 8px;
    text-align: center;
  }
  .trend-up { color: var(--vscode-charts-green); }
  .trend-down { color: var(--vscode-charts-red, #f14c4c); }
  .trend-neutral { opacity: 0.6; }
`;

/** Custom element that renders the weekly trend comparison card in Shadow DOM. */
export class WeeklyTrendCard extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private _data: WeeklyTrendData | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: WeeklyTrendData | null) {
    this._data = value;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _buildWeekCard(title: string, week: WeeklyTrendData["thisWeek"]): HTMLElement {
    const rateStr = week.shown > 0 ? `${week.rate.toFixed(1)}%` : "—";

    const card = document.createElement("div");
    card.className = "trend-card";

    const h3 = document.createElement("h3");
    h3.textContent = title;
    card.appendChild(h3);

    const stats: Array<[string, string]> = [
      ["Shown", String(week.shown)],
      ["Accepted", String(week.accepted)],
      ["Rate", rateStr],
      ["Chat", String(week.chat)],
    ];

    for (const [label, value] of stats) {
      const stat = document.createElement("div");
      stat.className = "trend-stat";
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.textContent = value;
      stat.appendChild(labelEl);
      stat.appendChild(valueEl);
      card.appendChild(stat);
    }

    return card;
  }

  private _render(): void {
    const fragment = document.createDocumentFragment();

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    fragment.appendChild(style);

    if (!this._data || (this._data.thisWeek.shown === 0 && this._data.lastWeek.shown === 0)) {
      this._shadow.replaceChildren(fragment);
      return;
    }

    const trend = this._data;

    const h2 = document.createElement("h2");
    h2.textContent = "📈 Weekly Trend";
    fragment.appendChild(h2);

    const container = document.createElement("div");
    container.className = "trend-container";

    container.appendChild(this._buildWeekCard("Last Week", trend.lastWeek));

    const thisWeekCard = this._buildWeekCard("This Week", trend.thisWeek);

    if (trend.thisWeek.shown > 0 && trend.lastWeek.shown > 0) {
      const sign = trend.rateDiff > 0 ? "+" : "";
      const cssClass = trend.rateDiff > 0 ? "trend-up" : trend.rateDiff < 0 ? "trend-down" : "trend-neutral";
      const arrow = trend.rateDiff > 0 ? "↑" : trend.rateDiff < 0 ? "↓" : "→";

      const diffEl = document.createElement("div");
      diffEl.className = `trend-diff ${cssClass}`;
      diffEl.textContent = `${arrow} ${sign}${trend.rateDiff.toFixed(1)}%`;
      thisWeekCard.appendChild(diffEl);
    }

    container.appendChild(thisWeekCard);
    fragment.appendChild(container);

    this._shadow.replaceChildren(fragment);
  }
}

if (!customElements.get("copilot-weekly-trend")) {
  customElements.define("copilot-weekly-trend", WeeklyTrendCard);
}
