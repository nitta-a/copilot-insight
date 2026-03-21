/**
 * ContextFreshnessMeter — Web Component (Custom Element) for displaying the
 * AI context freshness score, status, and refresh metadata.
 *
 * Usage:
 *   const el = document.createElement("copilot-freshness-meter") as ContextFreshnessMeter;
 *   el.setData(freshness, refreshAnalysis);
 *   container.appendChild(el);
 *
 * Methods:
 *   setData(freshness, refreshAnalysis) — provide data and re-render.
 */

import type { ContextFreshness, DashboardPayload } from "../../src/ui/dashboardMessages";
import { trunc } from "../dashboardUtils";

const SHADOW_STYLES = `
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

export class ContextFreshnessMeter extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private readonly _content: HTMLDivElement;
  private _freshness: ContextFreshness | null = null;
  private _refreshAnalysis: DashboardPayload["refreshAnalysis"] = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    this._content = document.createElement("div");
    this._shadow.append(style, this._content);
    this._render();
  }

  setData(freshness: ContextFreshness | null, refreshAnalysis: DashboardPayload["refreshAnalysis"]): void {
    this._freshness = freshness;
    this._refreshAnalysis = refreshAnalysis;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    this._content.replaceChildren();

    if (!this._freshness || this._refreshAnalysis.length === 0) {
      return;
    }

    const freshness = this._freshness;
    const latestRefresh = this._refreshAnalysis.at(-1) ?? null;
    const score = Math.max(0, Math.min(100, freshness.score));

    const statusLabel =
      freshness.status === "fresh" ? "Fresh" : freshness.status === "aging" ? "Aging" : "Exhausted";
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

    const heading = document.createElement("h2");
    heading.textContent = "🧠 Context Freshness";
    this._content.appendChild(heading);

    const card = document.createElement("div");
    card.className = "db-freshness-card";

    // Header row
    const header = document.createElement("div");
    header.className = "db-freshness-header";

    const headerLeft = document.createElement("div");
    const statusEl = document.createElement("div");
    statusEl.className = "db-freshness-status";
    statusEl.textContent = statusLabel;
    const scoreEl = document.createElement("div");
    scoreEl.style.cssText = "font-size:1.6em;font-weight:800;margin-top:2px";
    scoreEl.textContent = `${score.toFixed(0)}%`;
    headerLeft.appendChild(statusEl);
    headerLeft.appendChild(scoreEl);

    const headerRight = document.createElement("div");
    headerRight.style.cssText = "font-size:0.88em;opacity:0.8;text-align:right";
    headerRight.textContent = statusDetail;

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    card.appendChild(header);

    // Meter bar
    const meter = document.createElement("div");
    meter.className = "db-freshness-meter";
    const fill = document.createElement("div");
    fill.className = `db-freshness-fill ${freshness.status}`;
    fill.style.width = `${score}%`;
    meter.appendChild(fill);
    card.appendChild(meter);

    // Suggestion
    const suggestionEl = document.createElement("div");
    suggestionEl.className = "db-freshness-suggestion";
    suggestionEl.textContent = suggestion;
    card.appendChild(suggestionEl);

    // Meta cards
    const meta = document.createElement("div");
    meta.className = "db-freshness-meta";
    meta.appendChild(this._metaCard("Current Session Actions", String(freshness.actionCount)));
    meta.appendChild(this._metaCard("Latest Refresh ROI", latestRoi));
    meta.appendChild(this._metaCard("Recovery Delta", latestRecovery));
    const boundaryCard = this._metaCard("Latest Boundary", trunc(latestEventType, 22));
    const valueEl = boundaryCard.querySelector(".db-freshness-meta-value");
    if (valueEl) {
      (valueEl as HTMLElement).title = latestTimestamp;
    }
    meta.appendChild(boundaryCard);
    card.appendChild(meta);

    this._content.appendChild(card);
  }

  private _metaCard(label: string, value: string): HTMLElement {
    const card = document.createElement("div");
    card.className = "db-freshness-meta-card";
    const labelEl = document.createElement("div");
    labelEl.className = "db-freshness-meta-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "db-freshness-meta-value";
    valueEl.textContent = value;
    card.appendChild(labelEl);
    card.appendChild(valueEl);
    return card;
  }
}

if (!customElements.get("copilot-freshness-meter")) {
  customElements.define("copilot-freshness-meter", ContextFreshnessMeter);
}
