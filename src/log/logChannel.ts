import * as vscode from "vscode";

let _channel: vscode.OutputChannel | undefined;

/** Returns (creating if necessary) the singleton "Copilot Insight" OutputChannel. */
export function getLogChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("Copilot Insight");
  }
  return _channel;
}

/**
 * Returns whether detailed `[TIMING]` diagnostic logs are enabled.
 *
 * Controlled by the `copilot-insight.enableTimingLogs` setting (default: `false`).
 * Emitting per-file timing entries in a tight loop has measurable overhead, so
 * this is intentionally opt-in and should only be enabled when troubleshooting
 * slow parse times.
 */
export function isTimingLogsEnabled(): boolean {
  return vscode.workspace.getConfiguration("copilot-insight").get<boolean>("enableTimingLogs", false);
}
