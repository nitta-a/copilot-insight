/**
 * TagCloud — Web Component for displaying a keyword tag cloud.
 *
 * Font size and opacity are scaled linearly between the min and max counts.
 *
 * Usage:
 *   const el = document.createElement("copilot-tag-cloud") as TagCloud;
 *   el.data = topKeywords;
 *   container.replaceChildren(el);
 */

const SHADOW_STYLES = `
  :host {
    display: block;
  }
  h2 {
    font-size: 1.1em;
    margin: 24px 0 10px;
  }
  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 14px 16px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 8px;
    margin-bottom: 24px;
  }
  .tag-cloud-item {
    display: inline-block;
    color: var(--vscode-charts-blue);
    font-weight: 600;
    line-height: 1.3;
    cursor: default;
    transition: opacity 0.15s;
  }
  .tag-cloud-item:hover { opacity: 1 !important; }
`;

const MIN_EM = 0.85;
const MAX_EM = 2.2;
const MIN_OPACITY = 0.55;
const MAX_OPACITY = 1.0;

/** Custom element that renders a keyword tag cloud in Shadow DOM. */
export class TagCloud extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private _data: Array<{ word: string; count: number }> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: Array<{ word: string; count: number }>) {
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

    if (this._data.length === 0) {
      this._shadow.replaceChildren(fragment);
      return;
    }

    const counts = this._data.map((k) => k.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const range = maxCount - minCount || 1;

    const h2 = document.createElement("h2");
    h2.textContent = "🔍 Top Keywords";
    fragment.appendChild(h2);

    const cloud = document.createElement("div");
    cloud.className = "tag-cloud";

    for (const { word, count } of this._data) {
      const ratio = (count - minCount) / range;
      const size = (MIN_EM + ratio * (MAX_EM - MIN_EM)).toFixed(2);
      const opacity = (MIN_OPACITY + ratio * (MAX_OPACITY - MIN_OPACITY)).toFixed(2);

      const span = document.createElement("span");
      span.className = "tag-cloud-item";
      span.style.fontSize = `${size}em`;
      span.style.opacity = opacity;
      span.title = `${word} (${count})`;
      span.textContent = word;

      cloud.appendChild(span);
    }

    fragment.appendChild(cloud);
    this._shadow.replaceChildren(fragment);
  }
}

if (!customElements.get("copilot-tag-cloud")) {
  customElements.define("copilot-tag-cloud", TagCloud);
}
