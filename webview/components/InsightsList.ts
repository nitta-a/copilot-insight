/**
 * InsightsList — Lit Web Component that renders the 💡 Insights section.
 *
 * Replaces the `buildInsightsHtml` string-builder in `htmlBuilders.ts` with a
 * reactive Lit component so that HTML injection via `innerHTML` is avoided.
 *
 * Usage:
 *   const el = document.createElement("copilot-insights-list") as InsightsList;
 *   el.insights = payload.insights;
 *   container.appendChild(el);
 *
 * Properties:
 *   insights — array of insight text strings (may contain emoji prefixes).
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("copilot-insights-list")
export class InsightsList extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    h2 {
      font-size: 1.1em;
      margin: 0 0 12px;
    }
    .insights-section {
      display: flex;
      flex-direction: column;
    }
  `;

  @property({ type: Array }) insights: string[] = [];

  render() {
    if (this.insights.length === 0) {
      return nothing;
    }
    return html`
      <h2>💡 Insights</h2>
      <div class="insights-section">
        ${this.insights.map((text) => {
          const variant = /📈/.test(text) ? "positive" : /📉/.test(text) ? "negative" : "neutral";
          return html`<copilot-insight-card show-download variant=${variant}>${text}</copilot-insight-card>`;
        })}
      </div>
    `;
  }
}
