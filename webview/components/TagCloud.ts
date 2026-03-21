/**
 * TagCloud — Web Component (Custom Element) that renders a weighted tag cloud.
 *
 * Font size and opacity are scaled linearly between the min and max word counts
 * so the most frequent terms appear largest and most opaque.
 *
 * Usage:
 *   const el = document.createElement("copilot-tag-cloud");
 *   (el as TagCloud).tags = [{ word: "typescript", count: 12 }, …];
 *   container.appendChild(el);
 *
 * Setters:
 *   tags — array of { word: string; count: number } entries.
 */

const SHADOW_STYLES = `
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

const MIN_EM = 0.85;
const MAX_EM = 2.2;
const MIN_OPACITY = 0.55;
const MAX_OPACITY = 1.0;

export class TagCloud extends HTMLElement {
  private readonly _shadow: ShadowRoot;
  private readonly _content: HTMLDivElement;
  private _tags: Array<{ word: string; count: number }> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    this._content = document.createElement("div");
    this._shadow.append(style, this._content);
    this._render();
  }

  set tags(value: Array<{ word: string; count: number }>) {
    this._tags = value;
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    this._content.replaceChildren();

    if (this._tags.length === 0) {
      return;
    }

    const counts = this._tags.map((k) => k.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const range = maxCount - minCount || 1;

    const heading = document.createElement("h2");
    heading.textContent = "🔍 Top Keywords";
    this._content.appendChild(heading);

    const cloud = document.createElement("div");
    cloud.className = "tag-cloud";

    for (const { word, count } of this._tags) {
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

    this._content.appendChild(cloud);
  }
}

if (!customElements.get("copilot-tag-cloud")) {
  customElements.define("copilot-tag-cloud", TagCloud);
}
