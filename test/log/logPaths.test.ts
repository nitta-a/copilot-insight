import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { findCopilotDirs, parseRemoteExthostLog } from "../../src/log/logFileReader";
import type { ParsingContext } from "../../src/types";
import { findSessionRoot } from "../../src/utils/logPaths";

suite("findSessionRoot", () => {
  // NOTE: findSessionRoot uses path.sep to split the path, so it correctly
  // handles the native separator of the current OS. On macOS/Linux path.sep
  // is '/', and on Windows it is '\'. The tests below cover Unix/Mac-style
  // paths (running on Linux CI). Windows-backslash paths are verified when
  // tests run on Windows.

  test("finds session root in Mac-style path (no output_logging dir)", () => {
    const logPath = "/Users/user/Library/Application Support/Code/logs/20260304T120000/exthost/copilot-insight";
    const result = findSessionRoot(logPath);
    assert.strictEqual(result, "/Users/user/Library/Application Support/Code/logs/20260304T120000");
  });

  test("finds session root in Mac-style path (with output_logging dir)", () => {
    const logPath =
      "/Users/user/Library/Application Support/Code/logs/20260304T120000/exthost/output_logging_1/copilot-insight";
    const result = findSessionRoot(logPath);
    assert.strictEqual(result, "/Users/user/Library/Application Support/Code/logs/20260304T120000");
  });

  test("works regardless of how many intermediate directories exist", () => {
    // Simulate a very deeply nested path (depth-independent)
    const logPath =
      "/Users/user/Library/Application Support/Code - Insiders/logs/20260304T120000/exthost/output_logging_42/a/b/c/copilot-insight";
    const result = findSessionRoot(logPath);
    assert.strictEqual(result, "/Users/user/Library/Application Support/Code - Insiders/logs/20260304T120000");
  });

  test("returns null when path has no /logs/<timestamp> segment", () => {
    const logPath = "/some/unrelated/path/without/logs";
    const result = findSessionRoot(logPath);
    assert.strictEqual(result, null);
  });

  test("returns null when timestamp segment exists but not after /logs/", () => {
    // A segment that looks like a timestamp but is not under a 'logs' parent
    const logPath = "/projects/20260304T120000/src/extension";
    const result = findSessionRoot(logPath);
    assert.strictEqual(result, null);
  });

  test("returns null when /logs/ has no element after it", () => {
    const result = findSessionRoot("/Users/user/logs");
    assert.strictEqual(result, null);
  });

  test("returns the path itself when it exactly equals the session root", () => {
    const sessionRoot = "/Users/user/Library/Application Support/Code/logs/20260304T120000";
    const result = findSessionRoot(sessionRoot);
    assert.strictEqual(result, sessionRoot);
  });
});

suite("findCopilotDirs", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-test-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("finds GitHub.copilot dir at top level", async () => {
    const copilotDir = path.join(tmpDir, "GitHub.copilot");
    await fs.mkdir(copilotDir);
    const results = await findCopilotDirs(tmpDir);
    assert.deepStrictEqual(results, [copilotDir]);
  });

  test("finds github.copilot-chat dir (case-insensitive via toLowerCase)", async () => {
    const copilotDir = path.join(tmpDir, "github.copilot-chat");
    await fs.mkdir(copilotDir);
    const results = await findCopilotDirs(tmpDir);
    assert.deepStrictEqual(results, [copilotDir]);
  });

  test("finds GITHUB.COPILOT dir (all-caps, toLowerCase)", async () => {
    const copilotDir = path.join(tmpDir, "GITHUB.COPILOT");
    await fs.mkdir(copilotDir);
    const results = await findCopilotDirs(tmpDir);
    assert.deepStrictEqual(results, [copilotDir]);
  });

  test("finds multiple Copilot dirs in different subdirectories", async () => {
    const exthost = path.join(tmpDir, "exthost");
    await fs.mkdir(exthost);
    const dir1 = path.join(exthost, "GitHub.copilot");
    const dir2 = path.join(exthost, "GitHub.copilot-chat");
    await fs.mkdir(dir1);
    await fs.mkdir(dir2);
    const results = await findCopilotDirs(tmpDir);
    assert.strictEqual(results.length, 2);
    assert.ok(results.includes(dir1));
    assert.ok(results.includes(dir2));
  });

  test("finds Copilot dir nested inside output_logging subdir (Mac structure)", async () => {
    const exthost = path.join(tmpDir, "exthost");
    const outputLogging = path.join(exthost, "output_logging_1");
    await fs.mkdir(exthost);
    await fs.mkdir(outputLogging);
    const copilotDir = path.join(outputLogging, "GitHub.copilot");
    await fs.mkdir(copilotDir);
    const results = await findCopilotDirs(tmpDir);
    assert.deepStrictEqual(results, [copilotDir]);
  });

  test("does not recurse into Copilot dirs", async () => {
    const copilotDir = path.join(tmpDir, "GitHub.copilot");
    await fs.mkdir(copilotDir);
    // A subdirectory inside the copilot dir that also matches the pattern
    await fs.mkdir(path.join(copilotDir, "github.copilot-nightly"));
    const results = await findCopilotDirs(tmpDir);
    // Only the top-level match should be returned, not the nested one
    assert.deepStrictEqual(results, [copilotDir]);
  });

  test("respects maxDepth limit", async () => {
    const deep = path.join(tmpDir, "a", "b", "c");
    await fs.mkdir(deep, { recursive: true });
    const copilotDir = path.join(deep, "GitHub.copilot");
    await fs.mkdir(copilotDir);
    // With maxDepth=1, should not reach depth 3
    const results = await findCopilotDirs(tmpDir, 1);
    assert.deepStrictEqual(results, []);
  });

  test("returns empty array when no Copilot dirs exist", async () => {
    await fs.mkdir(path.join(tmpDir, "some-other-extension"));
    const results = await findCopilotDirs(tmpDir);
    assert.deepStrictEqual(results, []);
  });

  test("finds Copilot dir inside numbered exthost dir (exthost1)", async () => {
    const exthost1 = path.join(tmpDir, "exthost1");
    await fs.mkdir(exthost1);
    const copilotDir = path.join(exthost1, "GitHub.copilot");
    await fs.mkdir(copilotDir);
    const results = await findCopilotDirs(tmpDir);
    assert.deepStrictEqual(results, [copilotDir]);
  });

  test("finds Copilot dirs across multiple numbered exthost dirs", async () => {
    const exthost1 = path.join(tmpDir, "exthost1");
    const exthost82 = path.join(tmpDir, "exthost82");
    await fs.mkdir(exthost1);
    await fs.mkdir(exthost82);
    const dir1 = path.join(exthost1, "GitHub.copilot");
    const dir2 = path.join(exthost82, "GitHub.copilot-chat");
    await fs.mkdir(dir1);
    await fs.mkdir(dir2);
    const results = await findCopilotDirs(tmpDir);
    assert.strictEqual(results.length, 2);
    assert.ok(results.includes(dir1));
    assert.ok(results.includes(dir2));
  });
});

suite("parseRemoteExthostLog", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-remoteexthost-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeEmptyCtx(): ParsingContext {
    return {
      totalShown: 0,
      totalAccepted: 0,
      totalRejected: 0,
      totalChat: 0,
      acceptanceRate: 0,
      avgLatencyMs: 0,
      byDate: new Map(),
      byModel: new Map(),
      byChatModel: new Map(),
      byHour: new Map(),
      byChatIntent: new Map(),
      logFilesFound: 0,
      chatByDate: new Map(),
      chatByHour: new Map(),
      totalErrors: 0,
      errorsByType: new Map(),
      latencies: [],
      chatLatencies: [],
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0,
      chatAvgLatencyMs: 0,
      chatLatencyP50: 0,
      chatLatencyP95: 0,
      bySession: new Map(),
      byContextSource: new Map(),
      byContextEffectiveness: new Map(),
      subagentRequests: 0,
      agenticRatio: 0,
      autonomousDurationMs: 0,
      toolUsageStats: new Map(),
      subagentLoops: 0,
      subagentLoopsStarted: 0,
      completionRate: 0,
      subagentByModel: new Map(),
      autonomousDurationByModel: new Map(),
      agenticDepthByModel: new Map(),
      latencySum: 0,
      latencyCount: 0,
      chatLatencySum: 0,
      chatLatencyCount: 0,
      currentSessionId: "",
      activeSubagentLoop: null,
      activeSubagentLoopModel: null,
      activeSubagentLoopActionCount: 0,
      loopsStartedByModel: new Map(),
      loopsCompletedByModel: new Map(),
      totalLoopActionsByModel: new Map(),
      loopDistributionByModel: new Map(),
      planCount: 0,
      executedPlanCount: 0,
      userChoicesInPlan: 0,
      activePlanPending: false,
    };
  }

  test("silently skips when no exthost subdirectories exist", async () => {
    // Empty session dir — no exthost* dirs at all
    const ctx = makeEmptyCtx();
    await parseRemoteExthostLog(tmpDir, ctx);
    assert.strictEqual(ctx.logFilesFound, 0);
  });

  test("silently skips when exthost dirs exist but contain no remoteexthost.log", async () => {
    // exthost1 present but no remoteexthost.log inside
    await fs.mkdir(path.join(tmpDir, "exthost1"));
    const ctx = makeEmptyCtx();
    await parseRemoteExthostLog(tmpDir, ctx);
    assert.strictEqual(ctx.logFilesFound, 0);
  });

  test("parses remoteexthost.log inside exthost1 and increments logFilesFound", async () => {
    // Real layout: <session>/exthost1/remoteexthost.log
    const logContent = '{"envelope":{"type":"completion/shown","requestId":"r1"}}\n';
    await fs.mkdir(path.join(tmpDir, "exthost1"));
    await fs.writeFile(path.join(tmpDir, "exthost1", "remoteexthost.log"), logContent, "utf-8");
    const ctx = makeEmptyCtx();
    await parseRemoteExthostLog(tmpDir, ctx);
    assert.strictEqual(ctx.logFilesFound, 1);
  });

  test("parses remoteexthost.log content (acceptance counted) from exthost subdir", async () => {
    // Use the plain-text format that parseLegacyKeywordLine recognises.
    const shown = "suggestion shown\n";
    const accepted = "suggestion accepted\n";
    await fs.mkdir(path.join(tmpDir, "exthost1"));
    await fs.writeFile(path.join(tmpDir, "exthost1", "remoteexthost.log"), shown + accepted, "utf-8");
    const ctx = makeEmptyCtx();
    await parseRemoteExthostLog(tmpDir, ctx);
    assert.strictEqual(ctx.totalShown, 1);
    assert.strictEqual(ctx.totalAccepted, 1);
  });

  test("parses remoteexthost.log from multiple numbered exthost dirs (e.g. exthost1 and exthost82)", async () => {
    // Session with multiple exthost processes — each has its own remoteexthost.log
    const logContent = "suggestion shown\n";
    await fs.mkdir(path.join(tmpDir, "exthost1"));
    await fs.writeFile(path.join(tmpDir, "exthost1", "remoteexthost.log"), logContent, "utf-8");
    await fs.mkdir(path.join(tmpDir, "exthost82"));
    await fs.writeFile(path.join(tmpDir, "exthost82", "remoteexthost.log"), logContent, "utf-8");
    const ctx = makeEmptyCtx();
    await parseRemoteExthostLog(tmpDir, ctx);
    assert.strictEqual(ctx.logFilesFound, 2);
    assert.strictEqual(ctx.totalShown, 2);
  });

  test("ignores non-exthost sibling directories in session dir", async () => {
    // remoteagent.log and ptyhost.log live next to exthost dirs — should be ignored
    await fs.mkdir(path.join(tmpDir, "somedir"));
    await fs.writeFile(path.join(tmpDir, "somedir", "remoteexthost.log"), "anything\n", "utf-8");
    const ctx = makeEmptyCtx();
    await parseRemoteExthostLog(tmpDir, ctx);
    assert.strictEqual(ctx.logFilesFound, 0);
  });
});
