/**
 * ContextFreshnessMeter — Web Component for displaying the Context Freshness gauge.
 *
 * Usage:
 *   const el = document.createElement("copilot-freshness-meter") as ContextFreshnessMeter;
 *   el.data = { freshness, refreshAnalysis };
 *   container.replaceChildren(el);
 */

import type { RefreshAnalysis } from "../../src/types";
import type { ContextFreshness } from "../../src/ui/dashboardMessages";
import { trunc } from "../dashboardUtils";

export interface FreshnessData {
  freshness: ContextFreshness;
  refreshAnalysis: RefreshAnalysis[];
}

const SHADOW_STYLES = `
  :host {
    display: block;
  }
  h2 {
    font-size: 1.1em;
    margin: 24px 0 10px;
  }
  .freshness-card {
    background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 88%, transparent), transparent);
    border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 10px;
    padding: 16px;
    margin: 0 0 20px;
  }
  .freshness-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    margin-bottom: 10px;
  }
  .freshness-status {
    font-size: 0.85em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .freshness-score {
    font-size: 1.6em;
    font-weight: 800;
    margin-top: 2px;
  }
  .freshness-detail {
    font-size: 0.88em;
    opacity: 0.8;
    text-align: right;
  }
  .freshness-meter {
    height: 14px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--vscode-editor-inactiveSelectionBackground);
    margin: 10px 0 14px;
  }
  .freshness-fill {
    height: 100%;
    border-radius: 999px;
  }
  .freshness-fill.fresh { background: linear-gradient(90deg, #2aa952, #7ecb67); }
  .freshness-fill.aging { background: linear-gradient(90deg, #d2a51d, #f1cc45); }
  .freshness-fill.exhausted { background: linear-gradient(90deg, #d14b3d, #f07b58); }
  .freshness-suggestion {
    font-size: 0.88em;
    opacity: 0.84;
  }
  .freshness-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .freshness-meta-card {
    background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .freshness-meta-label {
    font-size: 0.75em;
    opacity: 0.7;
  }
  .freshness-meta-value {
    font-size: 1.05em;
    font-weight: 700;
    margin-top: 4px;
  }
`;

/** Custom element that renders the Context Freshness gauge card in Shadow DOM. */
export class ContextFreshnessMeter extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private _data: FreshnessData | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: FreshnessData | null) {
    this._data = value;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    const fragment = document.createDocumentFragment();

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    fragment.appendChild(style);

    if (!this._data || this._data.refreshAnalysis.length === 0) {
      this._shadow.replaceChildren(fragment);
      return;
    }

    const { freshness, refreshAnalysis } = this._data;
    const latestRefresh = refreshAnalysis.at(-1) ?? null;
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

    // Heading
    const h2 = document.createElement("h2");
    h2.textContent = "🧠 Context Freshness";
    fragment.appendChild(h2);

    // Card
    const card = document.createElement("div");
    card.className = "freshness-card";

    // Header
    const header = document.createElement("div");
    header.className = "freshness-header";

    const headerLeft = document.createElement("div");
    const statusEl = document.createElement("div");
    statusEl.className = "freshness-status";
    statusEl.textContent = statusLabel;
    const scoreEl = document.createElement("div");
    scoreEl.className = "freshness-score";
    scoreEl.textContent = `${score.toFixed(0)}%`;
    headerLeft.appendChild(statusEl);
    headerLeft.appendChild(scoreEl);

    const headerRight = document.createElement("div");
    headerRight.className = "freshness-detail";
    headerRight.textContent = statusDetail;

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    card.appendChild(header);

    // Meter
    const meter = document.createElement("div");
    meter.className = "freshness-meter";
    const fill = document.createElement("div");
    fill.className = `freshness-fill ${freshness.status}`;
    fill.style.width = `${score}%`;
    meter.appendChild(fill);
    card.appendChild(meter);

    // Suggestion text
    const suggestionEl = document.createElement("div");
    suggestionEl.className = "freshness-suggestion";
    suggestionEl.textContent = suggestion;
    card.appendChild(suggestionEl);

    // Meta grid
    const meta = document.createElement("div");
    meta.className = "freshness-meta";

    const metaItems = [
      { label: "Current Session Actions", value: String(freshness.actionCount), title: "" },
      { label: "Latest Refresh ROI", value: latestRoi, title: "" },
      { label: "Recovery Delta", value: latestRecovery, title: "" },
      { label: "Latest Boundary", value: trunc(latestEventType, 22), title: latestTimestamp },
    ];

    for (const item of metaItems) {
      const metaCard = document.createElement("div");
      metaCard.className = "freshness-meta-card";

      const labelEl = document.createElement("div");
      labelEl.className = "freshness-meta-label";
      labelEl.textContent = item.label;

      const valueEl = document.createElement("div");
      valueEl.className = "freshness-meta-value";
      valueEl.textContent = item.value;
      if (item.title) {
        valueEl.title = item.title;
      }

      metaCard.appendChild(labelEl);
      metaCard.appendChild(valueEl);
      meta.appendChild(metaCard);
    }

    card.appendChild(meta);
    fragment.appendChild(card);

    this._shadow.replaceChildren(fragment);
  }
}

if (!customElements.get("copilot-freshness-meter")) {
  customElements.define("copilot-freshness-meter", ContextFreshnessMeter);
}
