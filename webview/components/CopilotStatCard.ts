/**
 * CopilotStatCard — Web Component (Custom Element) for displaying a single
 * metric card (KPI or summary stat).
 *
 * Encapsulates the card UI inside a Shadow DOM so that global styles cannot
 * interfere with the card's internal layout.
 *
 * Usage:
 *   <copilot-stat-card
 *     value="42"
 *     label="Accepted Completions"
 *     highlight="blue"
 *     subtext="Editor: 1.2h / CLI: 0.3h">
 *   </copilot-stat-card>
 *
 * Observed attributes:
 *   value     — the primary metric value shown in large text.
 *   label     — the short description shown below the value.
 *   highlight — colour variant: 'blue' | 'green' | 'orange' | 'red' | 'warn'.
 *               Controls both the border and value text colour.
 *   subtext   — optional secondary line shown in smaller, dimmed text.
 */

const SHADOW_STYLES = `
  :host {
    display: block;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 8px;
    padding: 14px 12px;
    text-align: center;
    border: 1px solid transparent;
    box-sizing: border-box;
  }
  :host([highlight="blue"]) { border-color: var(--vscode-charts-blue); }
  :host([highlight="blue"]) .value { color: var(--vscode-charts-blue); }
  :host([highlight="green"]) { border-color: var(--vscode-charts-green); }
  :host([highlight="green"]) .value { color: var(--vscode-charts-green); }
  :host([highlight="orange"]) { border-color: var(--vscode-charts-orange, #cca700); }
  :host([highlight="orange"]) .value { color: var(--vscode-charts-orange, #cca700); }
  :host([highlight="red"]) { border-color: var(--vscode-charts-red, #f14c4c); }
  :host([highlight="red"]) .value { color: var(--vscode-charts-red, #f14c4c); }
  :host([highlight="warn"]) { border-color: var(--vscode-charts-red, #f14c4c); }
  :host([highlight="warn"]) .value { color: var(--vscode-charts-red, #f14c4c); }
  .value {
    font-size: 1.6em;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    font-size: 0.78em;
    opacity: 0.75;
  }
  .subtext {
    display: block;
    font-size: 0.7em;
    opacity: 0.6;
    margin-top: 2px;
  }
`;

/** Custom element that renders a styled metric card in Shadow DOM. */
export class CopilotStatCard extends HTMLElement {
  static readonly observedAttributes: string[] = ["value", "label", "highlight", "subtext"];

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
    const value = this.getAttribute("value") ?? "";
    const label = this.getAttribute("label") ?? "";
    const subtext = this.getAttribute("subtext");

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;

    const valueEl = document.createElement("div");
    valueEl.className = "value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "label";
    labelEl.textContent = label;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(style);
    fragment.appendChild(valueEl);
    fragment.appendChild(labelEl);

    if (subtext) {
      const subtextEl = document.createElement("span");
      subtextEl.className = "subtext";
      subtextEl.textContent = subtext;
      fragment.appendChild(subtextEl);
    }

    this._shadow.replaceChildren(fragment);
  }
}

if (!customElements.get("copilot-stat-card")) {
  customElements.define("copilot-stat-card", CopilotStatCard);
}
