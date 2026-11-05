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

  test("reads token and AI credit totals from the latest session usage snapshot", () => {
    const usage = {
      model: "claude-sonnet-5.5",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      reasoningTokens: 5,
      cost: 999,
      copilotUsage: { totalNanoAiu: 1_000_000_000 },
      accounting: { sourceSessionId: "session-1", usageId: "usage-1" },
    };
    const content = [
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}',
      JSON.stringify({
        type: "session.usage_record",
        timestamp: "2026-03-14T04:01:00.000Z",
        data: { usage },
      }),
      JSON.stringify({
        type: "session.usage_record",
        timestamp: "2026-03-14T04:01:00.000Z",
        data: { usage },
      }),
      JSON.stringify({
        type: "session.shutdown",
        data: {
          accountingSnapshot: {
            totalNanoAiu: 1_500_000_000,
            modelMetrics: {
              "claude-sonnet-5.5": {
                totalNanoAiu: 1_500_000_000,
                usage: {
                  inputTokens: 100,
                  outputTokens: 20,
                  cacheReadTokens: 80,
                  cacheWriteTokens: 10,
                  reasoningTokens: 5,
                },
              },
            },
          },
        },
      }),
    ].join("\n");

    const result = parseEventsJsonl(content);
    const expected = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      reasoningTokens: 5,
      totalNanoAiu: 1_500_000_000,
    };
    assert.deepStrictEqual(result.usage, expected);
    assert.deepStrictEqual(result.usageByModel.get("claude-sonnet-5.5"), expected);
    assert.deepStrictEqual(result.byDate.get("2026-03-14")?.usage, { ...expected, totalNanoAiu: 1_000_000_000 });
  });

  test("uses per-call usage records when no accounting snapshot is available", () => {
    const content = JSON.stringify({
      type: "session.usage_record",
      timestamp: "2026-03-14T04:01:00.000Z",
      data: {
        usage: {
          model: "gpt-6-luna",
          inputTokens: 50,
          outputTokens: 10,
          cacheReadTokens: 30,
          cacheWriteTokens: 5,
          reasoningTokens: 2,
          cost: 100,
          copilotUsage: { totalNanoAiu: 250_000_000 },
        },
      },
    });

    const result = parseEventsJsonl(content);
    assert.strictEqual(result.usage.inputTokens, 50);
    assert.strictEqual(result.usage.outputTokens, 10);
    assert.strictEqual(result.usage.totalNanoAiu, 250_000_000);
    assert.strictEqual(result.byDate.get("2026-03-14")?.usage?.totalNanoAiu, 250_000_000);
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

suite("CLI daily and thread consumption", () => {
  const start = { type: "session.start", data: { sessionId: "thread-a", startTime: "2026-11-01T23:00:00Z" } };
  const tokens = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 30, reasoningTokens: 5 };
  function call(sequence: number, timestamp: string | null, overrides: Record<string, unknown> = {}) {
    return {
      type: "session.usage_record",
      timestamp,
      data: {
        usage: {
          ...tokens,
          model: "model-a",
          cost: 99,
          copilotUsage: { totalNanoAiu: 1_000_000_000 },
          accounting: { sourceSessionId: "thread-a", sequence },
          ...overrides,
        },
      },
    };
  }
  function snapshot(totalNanoAiu: number) {
    return {
      type: "session.usage_checkpoint",
      timestamp: "2026-11-05T20:00:00Z",
      data: {
        accountingSnapshot: {
          totalNanoAiu,
          modelMetrics: { "model-a": { usage: tokens, totalNanoAiu } },
        },
      },
    };
  }
  const jsonl = (...events: object[]) => events.map((event) => JSON.stringify(event)).join("\n");

  test("uses the first session's absolute git root, falling back to cwd or unknown", () => {
    const project = (context: unknown) =>
      parseEventsJsonl(
        jsonl(
          { type: "session.start", data: { sessionId: "s", context } },
          { type: "session.start", data: { context: { gitRoot: "/later" } } },
        ),
      ).thread?.projectPath;
    assert.strictEqual(project({ gitRoot: "/repos/project", cwd: "/repos/project/sub" }), "/repos/project");
    assert.strictEqual(project({ gitRoot: "relative", cwd: "/work/project" }), "/work/project");
    assert.strictEqual(project({ cwd: "relative" }), null);
    assert.strictEqual(project(undefined), null);
  });

  test("keeps each model call on its actual UTC day across midnight and shutdown", () => {
    const result = parseEventsJsonl(
      jsonl(start, call(1, "2026-11-01T23:59:00Z"), call(2, "2026-11-02T00:01:00Z"), {
        type: "session.shutdown",
        timestamp: "2026-11-05T20:00:00Z",
        data: { accountingSnapshot: { totalNanoAiu: 2_500_000_000 } },
      }),
    );
    assert.deepStrictEqual([...result.byDate.keys()], ["2026-11-01", "2026-11-02"]);
    assert.strictEqual(result.byDate.get("2026-11-01")?.usage?.totalNanoAiu, 1_000_000_000);
    assert.strictEqual(result.byDate.get("2026-11-02")?.usage?.inputTokens, 100);
    assert.strictEqual(result.usage.totalNanoAiu, 2_500_000_000);
    assert.strictEqual(result.usage.inputTokens, 200);
  });

  test("normalizes offset timestamps to UTC, without counting cached input twice", () => {
    const result = parseEventsJsonl(jsonl(start, call(1, "2026-11-02T08:00:00+09:00")));
    assert.strictEqual(result.byDate.get("2026-11-01")?.usage?.inputTokens, 100);
    assert.strictEqual(result.usage.inputTokens + result.usage.outputTokens, 120);
  });

  test("adds calls after a checkpoint without replacing newer usage with old totals", () => {
    const result = parseEventsJsonl(
      jsonl(start, call(1, "2026-11-01T23:01:00Z"), snapshot(1_500_000_000), call(2, "2026-11-06T01:00:00Z")),
    );
    assert.strictEqual(result.usage.totalNanoAiu, 2_500_000_000);
    assert.strictEqual(result.usage.inputTokens, 200);
    assert.deepStrictEqual(result.usageByModel.get("model-a"), result.usage);
    assert.strictEqual(result.byDate.get("2026-11-06")?.usage?.totalNanoAiu, 1_000_000_000);
  });

  test("deduplicates repeated usage sequences and repeated checkpoints", () => {
    const record = call(1, "2026-11-01T23:01:00Z");
    const result = parseEventsJsonl(jsonl(start, record, record, snapshot(1_500_000_000), snapshot(1_500_000_000)));
    assert.strictEqual(result.usage.inputTokens, 100);
    assert.strictEqual(result.usage.totalNanoAiu, 1_500_000_000);
    assert.strictEqual(result.byDate.get("2026-11-01")?.usage?.inputTokens, 100);
  });

  test("does not re-add a late record already covered by a snapshot watermark", () => {
    const checkpoint = snapshot(1_500_000_000);
    const result = parseEventsJsonl(
      jsonl(
        start,
        {
          ...checkpoint,
          data: { ...checkpoint.data, usageAccountingWatermarks: { "thread-a": 1 } },
        },
        call(1, "2026-11-01T23:01:00Z"),
        call(2, "2026-11-06T00:00:00Z"),
      ),
    );
    assert.strictEqual(result.usage.inputTokens, 200);
    assert.strictEqual(result.usage.totalNanoAiu, 2_500_000_000);
    assert.strictEqual(result.byDate.get("2026-11-01")?.usage?.inputTokens, 100);
  });

  test("keeps snapshot-only and undated usage in thread totals, not an invented day", () => {
    const result = parseEventsJsonl(jsonl(start, snapshot(1_500_000_000), call(2, null)));
    assert.strictEqual(result.byDate.size, 0);
    assert.strictEqual(result.thread?.sessionId, "thread-a");
    assert.strictEqual(result.thread?.usage.totalNanoAiu, 2_500_000_000);
  });

  test("retains separate per-prompt totals and a bounded thread title", () => {
    const prompt = "Fix ".repeat(70);
    const result = parseEventsJsonl(
      jsonl(
        start,
        { type: "user.message", timestamp: "2026-11-01T23:01:00Z", data: { content: prompt } },
        call(1, "2026-11-01T23:02:00Z"),
        call(2, "2026-11-01T23:03:00Z"),
        { type: "user.message", timestamp: "2026-11-02T00:01:00Z", data: { content: "Second prompt" } },
        call(3, "2026-11-02T00:02:00Z"),
        { type: "user.message", data: { content: "Unanswered prompt" } },
      ),
    );
    assert.strictEqual(result.thread?.prompts, 3);
    assert.strictEqual(result.thread?.title.length, 160);
    assert.strictEqual(result.thread?.turns[0].usage.totalNanoAiu, 2_000_000_000);
    assert.strictEqual(result.thread?.turns[1].usage.totalNanoAiu, 1_000_000_000);
    assert.strictEqual(result.thread?.turns[2].usage.totalNanoAiu, null);
    assert.strictEqual(result.thread?.usage.totalNanoAiu, 3_000_000_000);
    assert.strictEqual(result.byDate.get("2026-11-02")?.prompts, 1);
  });

  test("preserves real zero credits and treats missing or invalid credits as unavailable", () => {
    for (const amount of [undefined, -1, "3", Number.MAX_SAFE_INTEGER + 1]) {
      const result = parseEventsJsonl(
        jsonl(start, call(1, "2026-11-01T23:01:00Z", { copilotUsage: { totalNanoAiu: amount } })),
      );
      assert.strictEqual(result.usage.totalNanoAiu, null);
    }
    const zero = parseEventsJsonl(jsonl(start, call(1, "2026-11-01T23:01:00Z", { copilotUsage: { totalNanoAiu: 0 } })));
    assert.strictEqual(zero.usage.totalNanoAiu, 0);
    const corrected = parseEventsJsonl(jsonl(start, call(1, "2026-11-01T23:01:00Z"), snapshot(0)));
    assert.strictEqual(corrected.usage.totalNanoAiu, 0);
  });

  test("keeps incomplete credit accounting unavailable even when a number is reported", () => {
    const result = parseEventsJsonl(jsonl(start, call(1, "2026-11-01T23:01:00Z", { aiCreditsStatus: "partial" })));
    assert.strictEqual(result.usage.totalNanoAiu, null);
    assert.strictEqual(result.usage.outputTokens, 20);
  });

  test("does not double count assistant.message tokens alongside usage records", () => {
    const result = parseEventsJsonl(
      jsonl(start, { type: "assistant.message", data: { outputTokens: 20 } }, call(1, "2026-11-01T23:01:00Z")),
    );
    assert.strictEqual(result.usage.outputTokens, 20);
    assert.strictEqual(result.byDate.get("2026-11-01")?.outputTokens, 20);
  });

  test("does not invent credits for token-only snapshot models", () => {
    const result = parseEventsJsonl(
      jsonl(start, {
        type: "session.shutdown",
        data: { modelMetrics: { "model-a": { usage: tokens } } },
      }),
    );
    assert.strictEqual(result.usage.totalNanoAiu, null);
    assert.strictEqual(result.usageByModel.get("model-a")?.totalNanoAiu, null);
    assert.strictEqual(result.usage.inputTokens, 100);
  });

  test("preserves legacy output tokens when a snapshot only reports credits", () => {
    const result = parseEventsJsonl(
      jsonl(
        start,
        { type: "assistant.message", data: { outputTokens: 25 } },
        { type: "session.shutdown", data: { totalNanoAiu: 1_000_000_000, modelMetrics: {} } },
      ),
    );
    assert.strictEqual(result.usage.outputTokens, 25);
    assert.strictEqual(result.usage.totalNanoAiu, 1_000_000_000);
    assert.strictEqual(result.byDate.get("2026-11-01")?.usage, undefined);
  });

  test("handles valid JSON primitives and uses the log-directory identity when start is missing", () => {
    const result = parseEventsJsonl(
      `null\n1\n[]\n${jsonl(call(1, "2026-11-01T23:01:00Z"))}`,
      "Copilot CLI",
      "directory-id",
    );
    assert.strictEqual(result.thread?.sessionId, "directory-id");
    assert.strictEqual(result.thread?.usage.inputTokens, 100);
  });
});

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

  test("invalidates cached usage when an existing session log changes", async () => {
    const sessionDir = path.join(tmpDir, "session-cache");
    const eventsPath = path.join(sessionDir, "events.jsonl");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      eventsPath,
      '{"type":"session.start","data":{"startTime":"2026-03-14T04:00:00.000Z"}}\n{"type":"user.message","data":{}}',
      "utf8",
    );

    const initial = await readCliStats(tmpDir);
    assert.strictEqual(initial.totalInteractions, 1);

    await fs.appendFile(eventsPath, '\n{"type":"user.message","data":{}}', "utf8");
    const refreshed = await readCliStats(tmpDir);
    assert.strictEqual(refreshed.totalInteractions, 2);
  });

  test("retains different threads and their usage when their titles and dates match", async () => {
    for (const sessionId of ["one", "two"]) {
      const dir = path.join(tmpDir, sessionId);
      await fs.mkdir(dir);
      await fs.writeFile(
        path.join(dir, "events.jsonl"),
        [
          JSON.stringify({ type: "session.start", data: { sessionId, startTime: "2026-11-01T00:00:00Z" } }),
          JSON.stringify({ type: "user.message", data: { content: "Same title" } }),
          JSON.stringify({
            type: "session.usage_record",
            timestamp: "2026-11-02T00:00:00Z",
            data: {
              usage: {
                model: "model-a",
                inputTokens: 100,
                outputTokens: 20,
                copilotUsage: { totalNanoAiu: 1_000_000_000 },
              },
            },
          }),
        ].join("\n"),
      );
    }
    const result = await readCliStats(tmpDir);
    assert.deepStrictEqual(result.threads.map((thread) => thread.sessionId).sort(), ["one", "two"]);
    assert.strictEqual(result.usage.totalNanoAiu, 2_000_000_000);
    assert.strictEqual(result.byDate.get("2026-11-02")?.usage?.totalNanoAiu, 2_000_000_000);
  });

  test("retains daily usage when merging a legacy session on the same date", async () => {
    for (const sessionId of ["a-detailed", "z-legacy"]) {
      const dir = path.join(tmpDir, sessionId);
      await fs.mkdir(dir);
      const event =
        sessionId === "a-detailed"
          ? {
              type: "session.usage_record",
              timestamp: "2026-11-01T00:00:00Z",
              data: { usage: { inputTokens: 100, outputTokens: 20, copilotUsage: { totalNanoAiu: 100 } } },
            }
          : { type: "user.message", timestamp: "2026-11-01T00:00:00Z", data: { content: "Hello" } };
      await fs.writeFile(path.join(dir, "events.jsonl"), JSON.stringify(event));
    }
    const result = await readCliStats(tmpDir);
    assert.strictEqual(result.byDate.get("2026-11-01")?.usage?.inputTokens, 100);
    assert.strictEqual(result.usage.totalNanoAiu, null);
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
