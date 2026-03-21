/**
 * ContextRichnessMeter — Lit Web Component for displaying the context richness
 * (file-reference count) status in the Overview tab.
 *
 * Usage:
 *   const el = document.createElement("copilot-richness-meter") as ContextRichnessMeter;
 *   el.richness = contextRichnessData;
 *   container.appendChild(el);
 *
 * Properties:
 *   richness — ContextRichnessData object (or null to clear the component).
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { ContextRichnessData } from "../../src/ui/dashboardMessages";

@customElement("copilot-richness-meter")
export class ContextRichnessMeter extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    h2 {
      font-size: 1.1em;
      margin: 0 0 12px;
    }
    .db-richness-card {
      background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 88%, transparent);
      border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 10px;
      padding: 16px;
      margin: 0 0 20px;
    }
    .db-richness-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 10px;
    }
    .db-richness-title {
      font-size: 0.9em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      opacity: 0.75;
    }
    .db-richness-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.82em;
      font-weight: 700;
    }
    .db-richness-badge.low {
      background: color-mix(in srgb, var(--vscode-charts-orange) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-orange) 34%, transparent);
    }
    .db-richness-badge.medium {
      background: color-mix(in srgb, var(--vscode-charts-blue) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 34%, transparent);
    }
    .db-richness-badge.rich {
      background: color-mix(in srgb, var(--vscode-charts-green) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-green) 34%, transparent);
    }
    .db-richness-meter {
      height: 10px;
      background: var(--vscode-editor-background, #1e1e1e);
      border-radius: 999px;
      overflow: hidden;
      margin: 10px 0 14px;
    }
    .db-richness-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.4s ease;
    }
    .db-richness-fill.low {
      background: linear-gradient(90deg, #d2a51d, #f1cc45);
    }
    .db-richness-fill.medium {
      background: linear-gradient(90deg, #007acc, #4fc3f7);
    }
    .db-richness-fill.rich {
      background: linear-gradient(90deg, #2aa952, #7ecb67);
    }
    .db-richness-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .db-richness-meta-card {
      background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
      border-radius: 8px;
      padding: 8px 12px;
      flex: 1;
      min-width: 90px;
    }
    .db-richness-meta-label {
      font-size: 0.74em;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    .db-richness-meta-value {
      font-size: 1.0em;
      font-weight: 700;
    }
    .db-richness-suggestion {
      font-size: 0.88em;
      opacity: 0.84;
      margin: 8px 0 0;
    }
  `;

  @property({ type: Object }) richness: ContextRichnessData | null = null;

  render() {
    const r = this.richness;
    if (!r) {
      return nothing;
    }

    const totalSessions = r.buckets.reduce((sum, b) => sum + b.sessionCount, 0);
    if (totalSessions === 0) {
      return nothing;
    }

    const statusLabel =
      r.status === "rich" ? "⭐ Rich Context" : r.status === "medium" ? "✅ Good Context" : "⚠ Needs More Context";

    const suggestion =
      r.status === "low"
        ? "チャットにファイルを添付すると、AI の回答精度が高まります"
        : r.status === "medium"
          ? "平均 1〜2 ファイルが添付されています。さらに増やすと改善できます"
          : "多くのセッションでリッチな参照コンテキストが提供されています";

    // Clamp fill to 0–100%: scale so 5 refs = 100%
    const fillPct = Math.min(100, (r.avgRefCount / 5) * 100);

    const meterClasses = classMap({ "db-richness-fill": true, [r.status]: true });
    const badgeClasses = classMap({ "db-richness-badge": true, [r.status]: true });

    return html`
      <div class="db-richness-card">
        <div class="db-richness-header">
          <span class="db-richness-title">Context Richness</span>
          <span class=${badgeClasses}>${statusLabel}</span>
        </div>
        <div class="db-richness-meter">
          <div
            class=${meterClasses}
            style=${styleMap({ width: `${fillPct}%` })}
          ></div>
        </div>
        <div class="db-richness-meta">
          ${this._metaCard("Avg Files / Session", r.avgRefCount.toFixed(1))}
          ${this._metaCard("Tracked Sessions", String(totalSessions))}
          ${this._metaCard("High-Context (3+)", String(r.buckets.slice(3).reduce((s, b) => s + b.sessionCount, 0)))}
        </div>
        <p class="db-richness-suggestion">${suggestion}</p>
      </div>
    `;
  }

  private _metaCard(label: string, value: string) {
    return html`
      <div class="db-richness-meta-card">
        <div class="db-richness-meta-label">${label}</div>
        <div class="db-richness-meta-value">${value}</div>
      </div>
    `;
  }
}
