import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { parseEventsJsonl, readCliStats } from "../../src/log/cliLogReader";

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
