/**
 * Real-time status-bar indicator showing current-session Copilot contribution.
 *
 * Phase 3 of the roadmap: a lightweight feedback mechanism that dynamically
 * displays acceptance rate and suggestion counts in the VS Code status bar.
 *
 * The indicator updates on every shown/accepted event from the
 * {@link InlineCompletionTracker} and shows one of these formats:
 *
 * - `$(copilot) 73% (42/58)` — normal mode
 * - `$(copilot) — no data`   — when no completions have been shown yet
 */

import * as vscode from "vscode";
import type { RealtimeInlineStats } from "../events/inlineCompletionWrapper";

export class StatusBarIndicator implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;
  private _disposed = false;

  constructor() {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.command = "copilot-insight.showCopilotUsage";
    this._update(undefined);
    this._item.show();
  }

  /** Refresh the indicator with the latest real-time stats. */
  update(stats: RealtimeInlineStats | undefined): void {
    if (this._disposed) {
      return;
    }
    this._update(stats);
  }

  dispose(): void {
    this._disposed = true;
    this._item.dispose();
  }

  private _update(stats: RealtimeInlineStats | undefined): void {
    if (!stats || stats.totalShown === 0) {
      this._item.text = "$(copilot) — no data";
      this._item.tooltip = "Copilot Insight: No completions tracked yet in this session";
      return;
    }

    const rate = ((stats.totalAccepted / stats.totalShown) * 100).toFixed(0);
    this._item.text = `$(copilot) ${rate}% (${stats.totalAccepted}/${stats.totalShown})`;
    this._item.tooltip = `Copilot Insight — Acceptance Rate: ${rate}%\nAccepted: ${stats.totalAccepted}\nShown: ${stats.totalShown}\n\nClick to open dashboard`;
  }
}
