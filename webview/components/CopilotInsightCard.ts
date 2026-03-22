/**
 * CopilotInsightCard — Lit Web Component for displaying a single auto-generated
 * insight observation.
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
 * Properties / Attributes:
 *   icon         — emoji or short string displayed before the slotted text.
 *   variant      — visual style: 'positive' | 'negative' | 'neutral' (default).
 *                  Controls the left-border accent colour.
 *   showDownload — when true, a 🖼️ download button is rendered that saves the
 *                  card as a PNG image.
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { downloadAsPng } from "../utils/pngExport";

@customElement("copilot-insight-card")
export class CopilotInsightCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 3px solid var(--vscode-charts-blue);
      border-radius: 4px;
      padding: 10px 14px;
      margin: 6px 0;
      font-size: 0.9em;
      box-sizing: border-box;
      position: relative;
    }
    :host([variant="positive"]) { border-left-color: var(--vscode-charts-green); }
    :host([variant="negative"]) { border-left-color: var(--vscode-charts-red, #f14c4c); }
    .icon { margin-right: 6px; }
    .download-btn {
      position: absolute;
      top: 4px;
      right: 6px;
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      font-size: 0.9em;
      padding: 2px 4px;
      color: var(--vscode-foreground);
    }
    :host(:hover) .download-btn { opacity: 0.6; }
    .download-btn:hover { opacity: 1 !important; }
  `;

  @property({ type: String, reflect: true }) icon = "";
  @property({ type: String, reflect: true }) variant = "";
  @property({ type: Boolean }) showDownload = false;

  private async _handleDownload(): Promise<void> {
    await downloadAsPng(this, "copilot-insight.png");
  }

  render() {
    return html`
      ${this.icon ? html`<span class="icon">${this.icon}</span>` : ""}
      <slot></slot>
      ${this.showDownload
        ? html`<button class="download-btn" title="Download as PNG" @click=${this._handleDownload}>🖼️</button>`
        : ""}
    `;
  }
}
