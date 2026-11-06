import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import * as vscode from "vscode";
import { parseCopilotLogs } from "../../src/log/copilotLogParser";
import { loadNativeModule, type NativeParseResult } from "../../src/log/nativeBridge";

suite("Native parser integration", () => {
  test("matches JavaScript log parsing for completion counts", async function () {
    let native: { parseLogFileNative(filePath: string): NativeParseResult };
    try {
      native = require(path.resolve(__dirname, "../../../native-parser"));
    } catch (error) {
      if (process.env["REQUIRE_NATIVE_TESTS"] === "1") {
        throw error;
      }
      this.skip();
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-native-"));
    const root = path.resolve(__dirname, "../../..");
    const bundledBridge = path.join(root, "dist", `native-bridge-test-${randomUUID()}.cjs`);
    const config = vscode.workspace.getConfiguration("copilot-insight");
    const originalPath = config.inspect<string>("cliLogPath")?.globalValue;
    try {
      const logUri = vscode.Uri.file(path.join(dir, "logs", "20261101T000000", "exthost"));
      const copilotDir = path.join(logUri.fsPath, "github.copilot");
      const cliDir = path.join(dir, "cli");
      await fs.mkdir(copilotDir, { recursive: true });
      await fs.mkdir(cliDir);
      await config.update("cliLogPath", cliDir, vscode.ConfigurationTarget.Global);
      const logPath = path.join(copilotDir, "copilot.log");
      await fs.writeFile(
        logPath,
        [
          { event: "suggestion_shown", model: "model-a", timestamp: "2026-11-01T10:00:00Z" },
          { event: "suggestion_shown", model: "model-a", timestamp: "2026-11-01T10:01:00Z" },
          { event: "suggestion_accepted", model: "model-a", timestamp: "2026-11-01T10:02:00Z" },
        ]
          .map((entry) => JSON.stringify(entry))
          .join("\n"),
      );
      assert.strictEqual(loadNativeModule(), null, "compiled test modules must use the JavaScript fallback");
      const js = await parseCopilotLogs(logUri);
      const rust = native.parseLogFileNative(logPath);
      assert.strictEqual(js.totalShown, 2);
      assert.strictEqual(js.totalAccepted, 1);
      assert.strictEqual(rust.totalShown, js.totalShown);
      assert.strictEqual(rust.totalAccepted, js.totalAccepted);
      assert.deepStrictEqual(rust.byDate["2026-11-01"], js.byDate.get("2026-11-01"));
      assert.strictEqual(rust.byModelShown["model-a"], js.byModel.get("model-a")?.shown);
      assert.strictEqual(rust.byModelAccepted["model-a"], js.byModel.get("model-a")?.accepted);

      await build({
        entryPoints: [path.join(root, "src/log/nativeBridge.ts")],
        outfile: bundledBridge,
        bundle: true,
        format: "cjs",
        platform: "node",
        external: ["vscode", "native-parser", "native-parser/*", "./native-parser/*", "../native-parser/*"],
      });
      const bridge = require(bundledBridge) as typeof import("../../src/log/nativeBridge");
      assert.ok(bridge.loadNativeModule(), bridge.getNativeLoadError() ?? "native module did not load");
      const bundledResult = bridge.parseLogFileNative(logPath);
      assert.ok(bundledResult);
      assert.strictEqual(bundledResult.totalShown, js.totalShown);
      assert.strictEqual(bundledResult.totalAccepted, js.totalAccepted);
    } finally {
      await config.update("cliLogPath", originalPath, vscode.ConfigurationTarget.Global);
      delete require.cache[bundledBridge];
      await fs.rm(bundledBridge, { force: true });
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
