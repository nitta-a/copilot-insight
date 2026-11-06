import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { exportAsCsv, exportAsJson } from "../../src/export/exportStats";
import { parseCopilotLogs } from "../../src/log/copilotLogParser";
import { buildDashboardPayload, buildSessionsPayload } from "../../src/ui/dashboardPayload";

suite("CLI usage integration", () => {
  test("reads logs and keeps dashboard and exports consistent after a refresh", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-integration-"));
    const config = vscode.workspace.getConfiguration("copilot-insight");
    const originalPath = config.inspect<string>("cliLogPath")?.globalValue;
    try {
      const cliDir = path.join(tmpDir, "cli");
      const sessionDir = path.join(cliDir, "session-1");
      const logUri = vscode.Uri.file(path.join(tmpDir, "logs", "20261101T000000", "exthost"));
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.mkdir(logUri.fsPath, { recursive: true });
      await config.update("cliLogPath", cliDir, vscode.ConfigurationTarget.Global);

      const eventsPath = path.join(sessionDir, "events.jsonl");
      const usage = (inputTokens: number, outputTokens: number, totalNanoAiu: number) =>
        JSON.stringify({
          type: "session.usage_record",
          timestamp: "2026-11-01T10:00:00Z",
          data: { usage: { model: "model-a", inputTokens, outputTokens, copilotUsage: { totalNanoAiu } } },
        });
      await fs.writeFile(
        eventsPath,
        [
          JSON.stringify({
            type: "session.start",
            data: { sessionId: "session-1", startTime: "2026-11-01T10:00:00Z" },
          }),
          JSON.stringify({ type: "user.message", data: { content: "Build charts" } }),
          "{broken json",
          usage(100, 20, 1_000_000_000),
        ].join("\n"),
      );

      const check = async (input: number, output: number, credits: number) => {
        const stats = await parseCopilotLogs(logUri);
        const dashboard = buildDashboardPayload(stats);
        const json = JSON.parse(exportAsJson(stats));
        const csv = exportAsCsv(stats);
        assert.strictEqual(stats.cliTotalInteractions, 1);
        assert.strictEqual(stats.cliUsage?.inputTokens, input);
        assert.strictEqual(stats.cliUsage?.outputTokens, output);
        assert.strictEqual(dashboard.summary.cliUsageStats?.totalTokens, input + output);
        assert.strictEqual(dashboard.summary.cliUsageStats?.totalAiCredits, credits);
        assert.strictEqual(dashboard.summary.cliUsageStats?.dailyUsage[0]?.totalTokens, input + output);
        assert.deepStrictEqual(
          dashboard.timeline.map((day) => [day.date, day.cliPrompts, day.shown, day.rate]),
          [["2026-11-01", 1, 0, null]],
        );
        assert.ok(
          buildSessionsPayload(stats).sessionSummaries.some((session) => session.sessionId === "cli:session-1"),
        );
        assert.strictEqual(json.summary.cliUsage.totalTokens, input + output);
        assert.strictEqual(json.summary.cliUsage.aiCredits, credits);
        assert.ok(csv.includes(`Copilot CLI Total Tokens,${input + output}\n`));
        assert.ok(csv.includes(`Copilot CLI AI Credits,${credits.toFixed(9)}\n`));
        assert.ok(csv.includes(`2026-11-01,0,0,,0,1,${input + output},${credits.toFixed(9)}`));
      };

      await check(100, 20, 1);
      await fs.appendFile(eventsPath, `\n${usage(50, 10, 500_000_000)}`);
      await check(150, 30, 1.5);
    } finally {
      await config.update("cliLogPath", originalPath, vscode.ConfigurationTarget.Global);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
