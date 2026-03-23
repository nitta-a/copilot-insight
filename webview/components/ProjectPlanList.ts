/**
 * ProjectPlanList — Lit Web Component that displays a horizontal list of
 * context-definition file cards at the top of the Prompt Insights tab.
 *
 * Sources:
 *  - "workspace"      — files in the current VS Code workspace
 *  - "user-prompts"   — VS Code user-level .instructions.md / .prompt.md files
 *  - "copilot-memory" — Copilot Plan Agent session memory files
 *
 * Clicking a card fires a "open-file" CustomEvent with { detail: { filePath } }.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ProjectContextFile } from "../../src/ui/dashboardMessages";

const SOURCE_LABELS: Record<ProjectContextFile["source"], string> = {
  workspace: "workspace",
  "user-prompts": "user prompts",
  "copilot-memory": "copilot memory",
};

@customElement("copilot-project-plan-list")
export class ProjectPlanList extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .ppl-section {
      margin: 0 0 20px;
    }
    .ppl-title {
      font-size: 0.85em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      opacity: 0.7;
      margin: 0 0 10px;
    }
    .ppl-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .ppl-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 60%, transparent);
      border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 10px 14px;
      cursor: pointer;
      max-width: 280px;
      min-width: 160px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .ppl-card:hover {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 80%, transparent);
      border-color: var(--vscode-focusBorder);
    }
    .ppl-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ppl-card-name {
      font-size: 0.88em;
      font-weight: 600;
      word-break: break-all;
      flex: 1;
    }
    .ppl-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 0.75em;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .ppl-badge-workspace {
      background: color-mix(in srgb, var(--vscode-charts-blue) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 35%, transparent);
      color: var(--vscode-charts-blue);
    }
    .ppl-badge-user-prompts {
      background: color-mix(in srgb, var(--vscode-charts-green) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-green) 35%, transparent);
      color: var(--vscode-charts-green);
    }
    .ppl-badge-copilot-memory {
      background: color-mix(in srgb, var(--vscode-charts-purple) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-purple) 35%, transparent);
      color: var(--vscode-charts-purple);
    }
    .ppl-preview {
      font-size: 0.78em;
      opacity: 0.65;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  @property({ type: Array }) files: ProjectContextFile[] = [];

  private _handleClick(filePath: string): void {
    this.dispatchEvent(
      new CustomEvent("open-file", {
        detail: { filePath },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _badgeClass(source: ProjectContextFile["source"]): string {
    if (source === "workspace") return "ppl-badge ppl-badge-workspace";
    if (source === "user-prompts") return "ppl-badge ppl-badge-user-prompts";
    return "ppl-badge ppl-badge-copilot-memory";
  }

  override render() {
    if (!this.files || this.files.length === 0) {
      return nothing;
    }
    return html`
      <div class="ppl-section">
        <div class="ppl-title">📋 Project Context Files</div>
        <div class="ppl-list">
          ${this.files.map(
            (f) => html`
              <div class="ppl-card" @click=${() => this._handleClick(f.path)}>
                <div class="ppl-card-header">
                  <span class="ppl-card-name">${f.name}</span>
                  <span class="${this._badgeClass(f.source)}">${SOURCE_LABELS[f.source]}</span>
                </div>
                ${f.preview ? html`<div class="ppl-preview">${f.preview}</div>` : nothing}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }
}
