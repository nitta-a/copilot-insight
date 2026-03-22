/**
 * CopilotStatCard — Lit Web Component for displaying a single metric card
 * (KPI or summary stat).
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
 * Properties / Attributes:
 *   value        — the primary metric value shown in large text.
 *   label        — the short description shown below the value.
 *   highlight    — colour variant: 'blue' | 'green' | 'orange' | 'red' | 'warn'.
 *                  Controls both the border and value text colour.
 *   subtext      — optional secondary line shown in smaller, dimmed text.
 *   showDownload — when true, a 🖼️ download button is rendered that saves the
 *                  card as a PNG image.
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { downloadAsPng } from "../utils/pngExport";

@customElement("copilot-stat-card")
export class CopilotStatCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 14px 12px;
      text-align: center;
      border: 1px solid transparent;
      box-sizing: border-box;
      position: relative;
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
    .download-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      font-size: 0.8em;
      padding: 2px 4px;
      color: var(--vscode-foreground);
    }
    :host(:hover) .download-btn { opacity: 0.6; }
    .download-btn:hover { opacity: 1 !important; }
  `;

  @property({ type: String }) value = "";
  @property({ type: String }) label = "";
  @property({ type: String, reflect: true }) highlight = "";
  @property({ type: String }) subtext = "";
  @property({ type: Boolean }) showDownload = false;

  private async _handleDownload(): Promise<void> {
    const safeName = this.label.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase() || "card";
    await downloadAsPng(this, `copilot-stat-${safeName}.png`);
  }

  render() {
    return html`
      <div class="value">${this.value}</div>
      <div class="label">${this.label}</div>
      ${this.subtext ? html`<span class="subtext">${this.subtext}</span>` : ""}
      ${this.showDownload
        ? html`<button class="download-btn" title="Download as PNG" @click=${this._handleDownload}>🖼️</button>`
        : ""}
    `;
  }
}
