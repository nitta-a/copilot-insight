import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { exportAsCsv, exportAsJson } from "../../src/export/exportStats";
import { parseCopilotLogs } from "../../src/log/copilotLogParser";
import { buildDashboardPayload } from "../../src/ui/dashboardPayload";

suite("Editor usage integration", () => {
  test("discovers logs and updates dashboard and exports after new activity", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-editor-"));
    const config = vscode.workspace.getConfiguration("copilot-insight");
    const originalPath = config.inspect<string>("cliLogPath")?.globalValue;
    try {
      const sessionDir = path.join(dir, "logs", "20261101T000000");
      const logUri = vscode.Uri.file(path.join(sessionDir, "exthost"));
      const copilotDir = path.join(logUri.fsPath, "output_logging_1", "GitHub.copilot");
      const cliDir = path.join(dir, "cli");
      await fs.mkdir(copilotDir, { recursive: true });
      await fs.mkdir(cliDir);
      await config.update("cliLogPath", cliDir, vscode.ConfigurationTarget.Global);
      const logPath = path.join(copilotDir, "copilot.log");
      const event = (name: string) =>
        JSON.stringify({ event: name, model: "model-a", timestamp: "2026-11-01T10:00:00Z" });
      await fs.writeFile(
        logPath,
        [event("suggestion_shown"), event("suggestion_shown"), event("suggestion_accepted")].join("\n"),
      );

      const check = async (shown: number, accepted: number, rate: number) => {
        const stats = await parseCopilotLogs(logUri);
        const dashboard = buildDashboardPayload(stats);
        const json = JSON.parse(exportAsJson(stats));
        const csv = exportAsCsv(stats);
        assert.strictEqual(stats.logFilesFound, 1);
        assert.strictEqual(stats.totalShown, shown);
        assert.strictEqual(stats.totalAccepted, accepted);
        assert.strictEqual(dashboard.summary.acceptanceRate, rate);
        assert.strictEqual(dashboard.timeline.find((day) => day.date === "2026-11-01")?.accepted, accepted);
        assert.strictEqual(json.summary.totalShown, shown);
        assert.strictEqual(json.summary.totalAccepted, accepted);
        assert.strictEqual(json.summary.acceptanceRate, rate);
        assert.ok(csv.includes(`2026-11-01,${shown},${accepted},${rate.toFixed(1)}%`));
      };
      await check(2, 1, 50);
      await fs.appendFile(logPath, `\n${event("suggestion_accepted")}`);
      await check(2, 2, 100);
    } finally {
      await config.update("cliLogPath", originalPath, vscode.ConfigurationTarget.Global);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
