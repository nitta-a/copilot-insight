import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as vscode from "vscode";
import type { CompletionAcceptEvent } from "../../src/events/eventSchema";
import { EventStorage } from "../../src/events/eventStorage";
import { EventTracker } from "../../src/events/eventTracker";
import { DbWorkerClientImpl } from "../../src/worker/dbWorkerClient";

suite("Stored event consumers", () => {
  test("persists a real VS Code document edit", async function () {
    this.timeout(10_000);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-edit-"));
    const context = {
      globalStorageUri: vscode.Uri.file(dir),
      logUri: vscode.Uri.file(path.join(dir, "edit-session")),
    } as vscode.ExtensionContext;
    const tracker = new EventTracker(context);
    try {
      const document = await vscode.workspace.openTextDocument({ language: "typescript", content: "" });
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), "const answer = 42;");
      assert.ok(await vscode.workspace.applyEdit(edit));
      const deadline = Date.now() + 5_000;
      let changes = tracker.storage
        .listDates()
        .flatMap((date) => tracker.storage.readByDate(date))
        .filter((event) => event.eventType === "textChange");
      while (changes.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        changes = tracker.storage
          .listDates()
          .flatMap((date) => tracker.storage.readByDate(date))
          .filter((event) => event.eventType === "textChange");
      }
      assert.strictEqual(changes.length, 1);
      assert.strictEqual(changes[0].sessionId, "edit-session");
      assert.strictEqual(changes[0].languageId, "typescript");
      assert.strictEqual(changes[0].charsAdded, "const answer = 42;".length);
      assert.strictEqual(changes[0].charsDeleted, 0);
    } finally {
      tracker.dispose();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("tracker persists and batches events for the real worker", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-tracker-"));
    const config = vscode.workspace.getConfiguration("copilot-insight");
    const originalAnalysis = config.inspect<boolean>("enableAdvancedAnalysis")?.globalValue;
    const worker = new DbWorkerClientImpl(path.resolve(__dirname, "../../../dist/worker/dbWorker.js"));
    const context = {
      globalStorageUri: vscode.Uri.file(dir),
      logUri: vscode.Uri.file(path.join(dir, "session-1")),
    } as vscode.ExtensionContext;
    let tracker: EventTracker | undefined;
    try {
      await config.update("enableAdvancedAnalysis", true, vscode.ConfigurationTarget.Global);
      tracker = new EventTracker(context, worker);
      for (let i = 0; i < 10; i++) {
        await tracker.recordSessionSignal({
          signalType: "chat-request",
          actor: "human",
          phase: "human",
          intent: "vscodePrompt",
          rawText: "hello",
        });
      }
      assert.strictEqual(tracker.bufferSize, 0);
      assert.strictEqual(tracker.storage.listDates().flatMap((date) => tracker!.storage.readByDate(date)).length, 10);

      assert.strictEqual((await worker.loadFromJsonl(dir)).loaded, 10);
      assert.strictEqual((await worker.query("events")).length, 10);
    } finally {
      tracker?.dispose();
      await worker.close();
      await config.update("enableAdvancedAnalysis", originalAnalysis, vscode.ConfigurationTarget.Global);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("worker reloads persisted events without duplicating them", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-worker-"));
    const storage = new EventStorage(dir);
    const worker = new DbWorkerClientImpl(path.resolve(__dirname, "../../../dist/worker/dbWorker.js"));
    const event: CompletionAcceptEvent = {
      sessionId: "session-1",
      timestamp: new Date().toISOString(),
      eventType: "completionAccept",
      languageId: "typescript",
      modelName: "model-a",
      latencyMs: 100,
      isPartialAccept: false,
      acceptedCharacters: 200,
      openEditorPaths: [],
    };
    try {
      await storage.append(event);
      await fs.appendFile(path.join(dir, "events", `${event.timestamp.slice(0, 10)}.jsonl`), "{broken json\n");
      assert.strictEqual((await worker.loadFromJsonl(dir)).loaded, 1);

      await storage.append({ ...event, acceptedCharacters: 100 });
      assert.strictEqual((await worker.loadFromJsonl(dir)).loaded, 2);
      assert.strictEqual((await worker.query("events")).length, 2);
    } finally {
      storage.dispose();
      await worker.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("MCP client reads persisted usage through the packaged server", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-mcp-"));
    const storage = new EventStorage(dir);
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "node",
      args: [path.resolve(__dirname, "../../../bin/mcp-server.js"), "--storage", dir],
    });
    try {
      await storage.append({
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        eventType: "completionAccept",
        languageId: "typescript",
        modelName: "model-a",
        latencyMs: 100,
        isPartialAccept: false,
        acceptedCharacters: 200,
        openEditorPaths: [],
      });
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some((tool) => tool.name === "get_usage_summary"));
      const response = await client.callTool({ name: "get_usage_summary", arguments: { days: 1 } });
      assert.strictEqual(response.isError, undefined);
      const content = response.content as Array<{ type: string; text: string }>;
      const result = JSON.parse(content[0].text);
      assert.strictEqual(result.totalAccepted, 1);
      assert.strictEqual(result.totalCharsAccepted, 200);
      assert.strictEqual(result.estimatedMinutesSaved, undefined);
      assert.deepStrictEqual(result.topLanguages, [{ language: "typescript", count: 1 }]);
      const modelResponse = await client.callTool({ name: "get_model_efficiency", arguments: {} });
      assert.strictEqual(modelResponse.isError, undefined);
      const model = JSON.parse((modelResponse.content as Array<{ text: string }>)[0].text);
      assert.deepStrictEqual(model.bestModelByLanguage, { typescript: "model-a" });
      assert.strictEqual(model.stats[0].totalAccepted, 1);
      assert.strictEqual(model.stats[0].totalCharsAccepted, 200);

      const anomalyResponse = await client.callTool({ name: "get_anomaly_report", arguments: {} });
      assert.strictEqual(anomalyResponse.isError, undefined);
      const anomaly = JSON.parse((anomalyResponse.content as Array<{ text: string }>)[0].text);
      assert.strictEqual(anomaly.baseline.sampleSize, 1);
      assert.strictEqual(anomaly.baseline.mean, 1);
      assert.deepStrictEqual(anomaly.anomalies, []);
      assert.strictEqual(anomaly.recentDays[0].count, 1);
    } finally {
      storage.dispose();
      await client.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
