import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { parseEventsJsonl, readCliStats } from "../../src/log/cliLogReader";
import { PROMPT_LENGTH_BUCKETS, getPromptLengthBucket } from "../../src/types";

// ---------------------------------------------------------------------------
// parseEventsJsonl — unit tests (no disk I/O)
// ---------------------------------------------------------------------------

suite("parseEventsJsonl", () => {
  test("returns empty result for empty content", () => {
    const result = parseEventsJsonl("");
    assert.strictEqual(result.byDate.size, 0);
    assert.strictEqual(result.totalInteractions, 0);
  });

  test("counts user.message events as prompts", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"user.message","data":{"content":"hello"}}',
      '{"type":"user.message","data":{"content":"world"}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.totalInteractions, 2);
    assert.strictEqual(result.byDate.get("2026-03-14")?.prompts, 2);
  });

  test("sums outputTokens from assistant.message events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"assistant.message","data":{"outputTokens":500}}',
      '{"type":"assistant.message","data":{"outputTokens":300}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.byDate.get("2026-03-14")?.outputTokens, 800);
  });

  test("uses session.start date to bucket events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-01-20T12:00:00.000Z"}}',
      '{"type":"user.message","data":{}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.ok(result.byDate.has("2026-01-20"), "Expected 2026-01-20 key");
    assert.strictEqual(result.byDate.get("2026-01-20")?.prompts, 1);
  });

  test("falls back to today when no session.start is present", () => {
    const todayKey = new Date().toISOString().substring(0, 10);
    const content = '{"type":"user.message","data":{"content":"hey"}}';
    const result = parseEventsJsonl(content);
    assert.ok(result.byDate.has(todayKey), `Expected today key ${todayKey}`);
    assert.strictEqual(result.byDate.get(todayKey)?.prompts, 1);
  });

  test("silently skips malformed JSON lines", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T00:00:00.000Z"}}',
      "NOT_JSON",
      '{"type":"user.message","data":{}}',
      "{broken",
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.totalInteractions, 1);
  });

  test("skips blank lines without error", () => {
    const content = "\n\n\n";
    const result = parseEventsJsonl(content);
    assert.strictEqual(result.totalInteractions, 0);
  });

  test("handles zero outputTokens gracefully", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T09:00:00.000Z"}}',
      '{"type":"assistant.message","data":{"outputTokens":0}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    // Zero tokens should not create an entry
    assert.strictEqual(result.byDate.get("2026-03-14")?.outputTokens ?? 0, 0);
  });

  test("accumulates prompts and tokens from multiple events on same day", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-04-01T08:00:00.000Z"}}',
      '{"type":"user.message","data":{}}',
      '{"type":"assistant.message","data":{"outputTokens":200}}',
      '{"type":"user.message","data":{}}',
      '{"type":"assistant.message","data":{"outputTokens":150}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    const stat = result.byDate.get("2026-04-01");
    assert.ok(stat);
    assert.strictEqual(stat.prompts, 2);
    assert.strictEqual(stat.outputTokens, 350);
    assert.strictEqual(result.totalInteractions, 2);
  });

  test("attributes assistant.message turns to session model from session.start", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z","model":"claude-opus-4.6"}}',
      '{"type":"user.message","data":{}}',
      '{"type":"assistant.message","data":{"outputTokens":500}}',
      '{"type":"user.message","data":{}}',
      '{"type":"assistant.message","data":{"outputTokens":300}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.interactionsByModel.get("claude-opus-4.6"), 2);
  });

  test("per-message model field overrides session model", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z","model":"claude-opus-4.6"}}',
      '{"type":"assistant.message","data":{"outputTokens":100,"model":"gpt-4o"}}',
      '{"type":"assistant.message","data":{"outputTokens":200}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.interactionsByModel.get("gpt-4o"), 1);
    assert.strictEqual(result.interactionsByModel.get("claude-opus-4.6"), 1);
  });

  test("falls back to defaultModel when no model in session.start", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"assistant.message","data":{"outputTokens":100}}',
    ].join("\n");

    const result = parseEventsJsonl(content, "Copilot CLI");
    assert.strictEqual(result.interactionsByModel.get("Copilot CLI"), 1);
  });

  test("interactionsByModel is empty when there are no assistant.message events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z","model":"claude-opus-4.6"}}',
      '{"type":"user.message","data":{}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.interactionsByModel.size, 0);
  });

  test("accumulates tool execution stats from tool.execution_complete events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"tool.execution_complete","data":{"toolName":"read_file","success":true}}',
      '{"type":"tool.execution_complete","data":{"toolName":"read_file","success":true}}',
      '{"type":"tool.execution_complete","data":{"toolName":"grep_search","success":false}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    const readFile = result.toolExecutions.get("read_file");
    assert.ok(readFile);
    assert.strictEqual(readFile.total, 2);
    assert.strictEqual(readFile.success, 2);
    assert.strictEqual(readFile.fail, 0);
    const grep = result.toolExecutions.get("grep_search");
    assert.ok(grep);
    assert.strictEqual(grep.total, 1);
    assert.strictEqual(grep.success, 0);
    assert.strictEqual(grep.fail, 1);
  });

  test("tracks per-tool model usage from tool.execution_complete events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z","model":"claude-opus-4.6"}}',
      '{"type":"tool.execution_complete","data":{"toolName":"read_file","success":true,"model":"gpt-4o"}}',
      '{"type":"tool.execution_complete","data":{"toolName":"read_file","success":true}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    const modelMap = result.toolModelUsage.get("read_file");
    assert.ok(modelMap);
    assert.strictEqual(modelMap.get("gpt-4o"), 1);
    assert.strictEqual(modelMap.get("claude-opus-4.6"), 1);
  });

  test("accumulates reasoningText length from assistant.message events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"assistant.message","data":{"outputTokens":100,"reasoningText":"hello"}}',
      '{"type":"assistant.message","data":{"outputTokens":200,"reasoningText":"world!"}}',
      '{"type":"assistant.message","data":{"outputTokens":50}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    // "hello" (5) + "world!" (6) = 11
    assert.strictEqual(result.reasoningTokens, 11);
  });

  test("accumulates agentTypes from subagent.started events", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"subagent.started","data":{"agentName":"Explore"}}',
      '{"type":"subagent.started","data":{"agentName":"Explore"}}',
      '{"type":"subagent.started","data":{"agentName":"AIAgentExpert"}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.agentTypes.get("Explore"), 2);
    assert.strictEqual(result.agentTypes.get("AIAgentExpert"), 1);
  });

  test("counts assistant.turn_start events in turnCount", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"assistant.turn_start","data":{}}',
      '{"type":"assistant.turn_end","data":{}}',
      '{"type":"assistant.turn_start","data":{}}',
      '{"type":"assistant.turn_end","data":{}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.turnCount, 2);
  });

  test("counts session.model_change events and updates sessionModel", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z","model":"claude-opus-4.6"}}',
      '{"type":"session.model_change","data":{"model":"gpt-4o"}}',
      '{"type":"assistant.message","data":{"outputTokens":100}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.modelChanges, 1);
    // After model change, assistant.message should use gpt-4o
    assert.strictEqual(result.interactionsByModel.get("gpt-4o"), 1);
  });

  test("new fields are zero/empty for empty content", () => {
    const result = parseEventsJsonl("");
    assert.strictEqual(result.toolExecutions.size, 0);
    assert.strictEqual(result.toolModelUsage.size, 0);
    assert.strictEqual(result.reasoningTokens, 0);
    assert.strictEqual(result.agentTypes.size, 0);
    assert.strictEqual(result.turnCount, 0);
    assert.strictEqual(result.modelChanges, 0);
  });
});

// ---------------------------------------------------------------------------
// readCliStats — integration tests (uses a temp directory)
// ---------------------------------------------------------------------------

suite("readCliStats", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-cli-test-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns empty result when directory does not exist", async () => {
    const result = await readCliStats(path.join(tmpDir, "nonexistent"));
    assert.strictEqual(result.byDate.size, 0);
    assert.strictEqual(result.totalInteractions, 0);
    assert.strictEqual(result.interactionsByModel.size, 0);
  });

  test("returns empty result when session-state dir is empty", async () => {
    const result = await readCliStats(tmpDir);
    assert.strictEqual(result.byDate.size, 0);
    assert.strictEqual(result.totalInteractions, 0);
  });

  test("reads a single session directory", async () => {
    const sessionDir = path.join(tmpDir, "abc-123");
    await fs.mkdir(sessionDir, { recursive: true });
    const events = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z","model":"claude-opus-4.6"}}',
      '{"type":"user.message","data":{"content":"hello"}}',
      '{"type":"assistant.message","data":{"outputTokens":400}}',
    ].join("\n");
    await fs.writeFile(path.join(sessionDir, "events.jsonl"), events, "utf8");

    const result = await readCliStats(tmpDir);
    assert.strictEqual(result.totalInteractions, 1);
    assert.strictEqual(result.byDate.get("2026-03-14")?.prompts, 1);
    assert.strictEqual(result.byDate.get("2026-03-14")?.outputTokens, 400);
    assert.strictEqual(result.interactionsByModel.get("claude-opus-4.6"), 1);
  });

  test("merges stats across multiple session directories on the same date", async () => {
    for (const uuid of ["session-a", "session-b"]) {
      const dir = path.join(tmpDir, uuid);
      await fs.mkdir(dir, { recursive: true });
      const events = [
        '{"type":"session.start","data":{"startTime":"2026-05-01T10:00:00.000Z"}}',
        '{"type":"user.message","data":{}}',
        '{"type":"assistant.message","data":{"outputTokens":100}}',
      ].join("\n");
      await fs.writeFile(path.join(dir, "events.jsonl"), events, "utf8");
    }

    const result = await readCliStats(tmpDir);
    assert.strictEqual(result.totalInteractions, 2);
    assert.strictEqual(result.byDate.get("2026-05-01")?.prompts, 2);
    assert.strictEqual(result.byDate.get("2026-05-01")?.outputTokens, 200);
  });

  test("silently skips session directories without events.jsonl", async () => {
    const dir = path.join(tmpDir, "no-events");
    await fs.mkdir(dir, { recursive: true });
    // No events.jsonl written

    const result = await readCliStats(tmpDir);
    assert.strictEqual(result.totalInteractions, 0);
  });

  test("silently skips unreadable files and continues", async () => {
    // Valid session
    const validDir = path.join(tmpDir, "valid-session");
    await fs.mkdir(validDir, { recursive: true });
    await fs.writeFile(
      path.join(validDir, "events.jsonl"),
      '{"type":"session.start","data":{"startTime":"2026-06-01T00:00:00.000Z"}}\n{"type":"user.message","data":{}}\n',
      "utf8",
    );

    // Directory named events.jsonl to cause a read error
    const brokenDir = path.join(tmpDir, "broken-session");
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.mkdir(path.join(brokenDir, "events.jsonl"), { recursive: true }); // dir, not file

    const result = await readCliStats(tmpDir);
    assert.strictEqual(result.totalInteractions, 1);
    assert.strictEqual(result.byDate.get("2026-06-01")?.prompts, 1);
  });
});

// ---------------------------------------------------------------------------
// getPromptLengthBucket — unit tests
// ---------------------------------------------------------------------------

suite("getPromptLengthBucket", () => {
  test("assigns 0-char message to bucket 0-50", () => {
    assert.strictEqual(getPromptLengthBucket(0), "0-50");
  });

  test("assigns 25-char message to bucket 0-50", () => {
    assert.strictEqual(getPromptLengthBucket(25), "0-50");
  });

  test("assigns 50-char message to bucket 0-50", () => {
    assert.strictEqual(getPromptLengthBucket(50), "0-50");
  });

  test("assigns 51-char message to bucket 51-100", () => {
    assert.strictEqual(getPromptLengthBucket(51), "51-100");
  });

  test("assigns 75-char message to bucket 51-100", () => {
    assert.strictEqual(getPromptLengthBucket(75), "51-100");
  });

  test("assigns 100-char message to bucket 51-100", () => {
    assert.strictEqual(getPromptLengthBucket(100), "51-100");
  });

  test("assigns 101-char message to bucket 101-200", () => {
    assert.strictEqual(getPromptLengthBucket(101), "101-200");
  });

  test("assigns 150-char message to bucket 101-200", () => {
    assert.strictEqual(getPromptLengthBucket(150), "101-200");
  });

  test("assigns 200-char message to bucket 101-200", () => {
    assert.strictEqual(getPromptLengthBucket(200), "101-200");
  });

  test("assigns 201-char message to bucket 201+", () => {
    assert.strictEqual(getPromptLengthBucket(201), "201+");
  });

  test("assigns very long message to bucket 201+", () => {
    assert.strictEqual(getPromptLengthBucket(5000), "201+");
  });

  test("PROMPT_LENGTH_BUCKETS covers all buckets with correct midpoints", () => {
    assert.strictEqual(PROMPT_LENGTH_BUCKETS.length, 4);
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[0]!.key, "0-50");
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[0]!.midpoint, 25);
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[1]!.key, "51-100");
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[1]!.midpoint, 75);
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[2]!.key, "101-200");
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[2]!.midpoint, 150);
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[3]!.key, "201+");
    assert.strictEqual(PROMPT_LENGTH_BUCKETS[3]!.midpoint, 300);
  });
});

// ---------------------------------------------------------------------------
// parseEventsJsonl — promptEffectiveness tests
// ---------------------------------------------------------------------------

suite("parseEventsJsonl — promptEffectiveness", () => {
  test("returns empty promptEffectiveness for empty content", () => {
    const result = parseEventsJsonl("");
    assert.deepStrictEqual(result.promptEffectiveness, {});
  });

  test("records shown for user.message with short content", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"user.message","data":{"content":"hi"}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.accepted, 0);
  });

  test("increments accepted when assistant.message follows user.message", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"user.message","data":{"content":"hello world"}}',
      '{"type":"assistant.message","data":{"outputTokens":100}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.accepted, 1);
  });

  test("does not increment accepted when assistant.message has zero outputTokens", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"user.message","data":{"content":"hi"}}',
      '{"type":"assistant.message","data":{"outputTokens":0}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.accepted, 0);
  });

  test("routes messages to correct buckets by length", () => {
    // Build content string with one message per length bucket.
    const short = "x".repeat(30); // 0-50
    const medium = "x".repeat(75); // 51-100
    const long = "x".repeat(150); // 101-200
    const veryLong = "x".repeat(300); // 201+

    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      `{"type":"user.message","data":{"content":"${short}"}}`,
      '{"type":"assistant.message","data":{"outputTokens":10}}',
      `{"type":"user.message","data":{"content":"${medium}"}}`,
      '{"type":"assistant.message","data":{"outputTokens":10}}',
      `{"type":"user.message","data":{"content":"${long}"}}`,
      '{"type":"assistant.message","data":{"outputTokens":10}}',
      `{"type":"user.message","data":{"content":"${veryLong}"}}`,
      '{"type":"assistant.message","data":{"outputTokens":10}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.accepted, 1);
    assert.strictEqual(result.promptEffectiveness["51-100"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["51-100"]?.accepted, 1);
    assert.strictEqual(result.promptEffectiveness["101-200"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["101-200"]?.accepted, 1);
    assert.strictEqual(result.promptEffectiveness["201+"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["201+"]?.accepted, 1);
  });

  test("treats user.message with no content field as zero-length (bucket 0-50)", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"user.message","data":{}}',
      '{"type":"assistant.message","data":{"outputTokens":50}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.shown, 1);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.accepted, 1);
  });

  test("accumulates multiple messages in the same bucket", () => {
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      '{"type":"user.message","data":{"content":"first"}}',
      '{"type":"assistant.message","data":{"outputTokens":10}}',
      '{"type":"user.message","data":{"content":"second"}}',
      '{"type":"assistant.message","data":{"outputTokens":10}}',
    ].join("\n");

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.shown, 2);
    assert.strictEqual(result.promptEffectiveness["0-50"]?.accepted, 2);
  });
});
