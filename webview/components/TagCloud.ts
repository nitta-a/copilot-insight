/**
 * TagCloud — Lit Web Component that renders a weighted tag cloud.
 *
 * Font size and opacity are scaled linearly between the min and max word counts
 * so the most frequent terms appear largest and most opaque.
 *
 * Usage:
 *   const el = document.createElement("copilot-tag-cloud");
 *   (el as TagCloud).tags = [{ word: "typescript", count: 12 }, …];
 *   container.appendChild(el);
 *
 * Properties:
 *   tags — array of { word: string; count: number } entries.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

const MIN_EM = 0.85;
const MAX_EM = 2.2;
const MIN_OPACITY = 0.55;
const MAX_OPACITY = 1.0;

@customElement("copilot-tag-cloud")
export class TagCloud extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    h2 {
      font-size: 1.1em;
      margin: 0 0 12px;
    }
    .tag-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .tag-cloud-item {
      cursor: default;
      transition: opacity 0.15s;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .tag-cloud-item:hover {
      opacity: 1 !important;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
  `;

  @property({ type: Array }) tags: Array<{ word: string; count: number }> = [];

  render() {
    if (this.tags.length === 0) {
      return nothing;
    }

    const counts = this.tags.map((k) => k.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const range = maxCount - minCount || 1;

    return html`
      <h2>🔍 Top Keywords</h2>
      <div class="tag-cloud">
        ${this.tags.map(({ word, count }) => {
          const ratio = (count - minCount) / range;
          const size = (MIN_EM + ratio * (MAX_EM - MIN_EM)).toFixed(2);
          const opacity = (MIN_OPACITY + ratio * (MAX_OPACITY - MIN_OPACITY)).toFixed(2);
          return html`<span
            class="tag-cloud-item"
            style="font-size:${size}em;opacity:${opacity}"
            title="${word} (${count})"
          >${word}</span>`;
        })}
      </div>
    `;
  }
}
