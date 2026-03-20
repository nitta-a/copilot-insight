/**
 * CopilotInsightCard — Web Component (Custom Element) for displaying a single
 * auto-generated insight observation.
 *
 * Encapsulates the card UI inside a Shadow DOM. The insight text (which may
 * contain inline HTML such as `<strong>`) is projected through a `<slot>` so
 * the host document controls the content while this component controls the
 * presentational chrome.
 *
 * Usage:
 *   <copilot-insight-card icon="📈" variant="positive">
 *     Acceptance rate is <strong>+3.2%</strong> higher than last week.
 *   </copilot-insight-card>
 *
 * Observed attributes:
 *   icon    — emoji or short string displayed before the slotted text.
 *   variant — visual style: 'positive' | 'negative' | 'neutral' (default).
 *             Controls the left-border accent colour.
 */

const SHADOW_STYLES = `
  :host {
    display: block;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-left: 3px solid var(--vscode-charts-blue);
    border-radius: 4px;
    padding: 10px 14px;
    margin: 6px 0;
    font-size: 0.9em;
    box-sizing: border-box;
  }
  :host([variant="positive"]) { border-left-color: var(--vscode-charts-green); }
  :host([variant="negative"]) { border-left-color: var(--vscode-charts-red, #f14c4c); }
  .icon { margin-right: 6px; }
`;

/** Custom element that renders a styled insight card with slotted content. */
export class CopilotInsightCard extends HTMLElement {
  static readonly observedAttributes: string[] = ["icon", "variant"];

  private readonly _shadow: ShadowRoot;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._render();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue) {
      this._render();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _render(): void {
    const icon = this.getAttribute("icon");

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;

    const slot = document.createElement("slot");

    const fragment = document.createDocumentFragment();
    fragment.appendChild(style);

    if (icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "icon";
      iconEl.textContent = icon;
      fragment.appendChild(iconEl);
    }

    fragment.appendChild(slot);

    this._shadow.replaceChildren(fragment);
  }
}

if (!customElements.get("copilot-insight-card")) {
  customElements.define("copilot-insight-card", CopilotInsightCard);
}
