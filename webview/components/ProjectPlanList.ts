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
  workspace: "Workspace",
  "user-prompts": "User Prompts",
  "copilot-memory": "Copilot Memory",
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
    .source-group {
      margin-bottom: 10px;
      border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      overflow: hidden;
    }
    .source-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 14px;
      cursor: pointer;
      background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 40%, transparent);
      user-select: none;
      list-style: none;
    }
    .source-header::-webkit-details-marker {
      display: none;
    }
    .source-header::marker {
      display: none;
    }
    .source-header:hover {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 80%, transparent);
    }
    .source-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.88em;
      font-weight: 700;
    }
    .source-chevron {
      font-size: 0.75em;
      opacity: 0.7;
      transition: transform 0.15s ease;
    }
    details[open] .source-chevron {
      transform: rotate(90deg);
    }
    .source-name {
      font-size: 0.85em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      opacity: 0.85;
    }
    .file-count-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 0.75em;
      font-weight: 600;
      white-space: nowrap;
      background: color-mix(in srgb, var(--vscode-badge-background) 80%, transparent);
      color: var(--vscode-badge-foreground);
    }
    .file-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 12px 14px;
      background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent);
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

  private _formatSourceName(source: string): string {
    return SOURCE_LABELS[source as ProjectContextFile["source"]] ?? source;
  }

  private _groupFilesBySource(): Record<string, ProjectContextFile[]> {
    return this.files.reduce(
      (acc, file) => {
        const source = file.source ?? "other";
        if (!acc[source]) acc[source] = [];
        acc[source].push(file);
        return acc;
      },
      {} as Record<string, ProjectContextFile[]>,
    );
  }

  private _renderFileCard(f: ProjectContextFile) {
    return html`
      <div class="ppl-card" @click=${() => this._handleClick(f.path)}>
        <div class="ppl-card-header">
          <span class="ppl-card-name">${f.name}</span>
        </div>
        ${f.preview ? html`<div class="ppl-preview">${f.preview}</div>` : nothing}
      </div>
    `;
  }

  override render() {
    if (!this.files || this.files.length === 0) {
      return nothing;
    }

    const groupedFiles = this._groupFilesBySource();

    return html`
      <div class="ppl-section">
        <div class="ppl-title">📋 Project Context Files</div>
        ${Object.entries(groupedFiles).map(
          ([source, files]) => html`
            <details class="source-group" ?open=${source === "workspace"}>
              <summary class="source-header">
                <div class="source-header-left">
                  <span class="source-chevron">▶</span>
                  <span class="source-name">${this._formatSourceName(source)}</span>
                </div>
                <span class="file-count-badge">${files.length}</span>
              </summary>
              <div class="file-list">
                ${files.map((f) => this._renderFileCard(f))}
              </div>
            </details>
          `,
        )}
      </div>
    `;
  }
}
