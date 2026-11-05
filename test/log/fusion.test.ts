import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseEventsJsonl, readCliStats } from "../../src/log/cliLogReader";
import { fusionReconciliation, parseFusion, summarizeFusion } from "../../src/log/fusion";

suite("Fusion accounting", () => {
  const usage = {
    requestCount: 1,
    inputTokens: 10,
    outputTokens: 2,
    cachedTokens: 3,
    cacheWriteTokens: 4,
    totalNanoAiu: 100,
  };
  const event = (type: string, data: object, timestamp = "2026-01-01T01:00:00Z") =>
    JSON.stringify({ type, timestamp, data });
  const resolve = (fusionId: string, pattern: string) =>
    event("session.fusion_resolved", {
      fusionId,
      pattern,
      syntheticModel: "fusion",
      phasePlan: [{ kind: "primary" }, { kind: "judge", conditional: true }],
    });
  const phase = (fusionId: string, phaseKind: string, verdict: string | null = null, extra = {}) =>
    event("assistant.fusion_phase_completed", {
      fusionId,
      phaseId: phaseKind,
      phaseKind,
      model: "model",
      verdict,
      usage,
      ...extra,
    });
  const complete = (fusionId: string, count: number) =>
    event("session.fusion_completed", {
      fusionId,
      ...Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, value * count])),
    });
  const jsonl = (...lines: string[]) => lines.join("\n");

  test("retains observed paths, deduplicates phases and reconciles totals", () => {
    const primary = phase("c", "primary");
    const runs = parseFusion(
      jsonl(
        resolve("s", "single"),
        phase("s", "primary"),
        complete("s", 1),
        resolve("a", "cascade"),
        phase("a", "primary"),
        phase("a", "judge", "accept"),
        complete("a", 2),
        resolve("c", "cascade"),
        primary,
        primary,
        phase("c", "judge", "reject"),
        phase("c", "repair"),
        complete("c", 3),
        complete("c", 3),
        resolve("p", "cascade"),
        phase("p", "primary"),
      ),
    );
    assert.deepEqual(
      runs.map((run) => run.phases.map((p) => p.kind)),
      [["primary"], ["primary", "judge"], ["primary", "judge", "repair"], ["primary"]],
    );
    assert.deepEqual(runs.map(fusionReconciliation), ["match", "match", "match", "unavailable"]);
    const summary = summarizeFusion(runs, "2026-01-01", "2026-01-01");
    assert.equal(summary.judged, 2);
    assert.equal(summary.repaired, 1);
    assert.equal(summary.roles.find(([role]) => role === "primary")?.[1], 400);
  });

  test("preserves missing values and unknown phases and detects mismatches", () => {
    const runs = parseFusion(
      jsonl(
        resolve("x", "unseen"),
        phase("x", "unseen", null, { usage: { inputTokens: 3 }, durationMs: null }),
        complete("x", 1),
        resolve("y", "single"),
        phase("y", "primary"),
      ),
    );
    assert.equal(runs[0].phases[0].usage.totalNanoAiu, null);
    assert.equal(runs[0].phases[0].durationMs, null);
    assert.equal(fusionReconciliation(runs[0]), "mismatch");
    assert.equal(fusionReconciliation(runs[1]), "unavailable");
    assert.equal(summarizeFusion(runs, "2026-01-02", "2026-01-02").judged, 0);
  });

  test("filters the judge denominator and repair numerator by run date", () => {
    const runs = parseFusion(
      jsonl(
        resolve("a", "cascade"),
        phase("a", "judge"),
        phase("a", "repair"),
        event("session.fusion_resolved", { fusionId: "b", pattern: "cascade" }, "2026-01-02T01:00:00Z"),
        event(
          "assistant.fusion_phase_completed",
          { fusionId: "b", phaseId: "judge", phaseKind: "judge", usage },
          "2026-01-02T01:00:00Z",
        ),
      ),
    );
    const first = summarizeFusion(runs, "2026-01-01", "2026-01-01");
    const second = summarizeFusion(runs, "2026-01-02", "2026-01-02");
    assert.deepEqual([first.judged, first.repaired], [1, 1]);
    assert.deepEqual([second.judged, second.repaired], [1, 0]);
  });

  test("Fusion does not increase existing session accounting", () => {
    const start = event("session.start", { sessionId: "session" });
    const record = event("session.usage_record", {
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        copilotUsage: { totalNanoAiu: 100 },
      },
    });
    const base = parseEventsJsonl(jsonl(start, record));
    const withFusion = parseEventsJsonl(
      jsonl(start, record, resolve("f", "single"), phase("f", "primary"), complete("f", 1)),
    );
    assert.deepEqual(withFusion.usage, base.usage);
    assert.equal(withFusion.thread?.fusionRuns?.length, 1);
    assert.equal(withFusion.usage.cacheReadTokens, 3);
  });

  test("merges overlapping session files while keeping complementary phases and separate sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fusion-"));
    try {
      const write = async (folder: string, session: string, lines: string[]) => {
        await fs.mkdir(path.join(root, folder));
        await fs.writeFile(
          path.join(root, folder, "events.jsonl"),
          jsonl(event("session.start", { sessionId: session }), ...lines),
        );
      };
      await write("a", "one", [resolve("f", "cascade"), phase("f", "primary")]);
      await write("b", "one", [phase("f", "primary"), phase("f", "judge")]);
      await write("c", "two", [resolve("f", "single"), phase("f", "primary")]);
      const stats = await readCliStats(root);
      const runs = stats.threads.flatMap((thread) => thread.fusionRuns ?? []);
      assert.equal(runs.length, 2);
      assert.deepEqual(runs.map((run) => run.phases.length).sort(), [1, 2]);
      assert.equal(summarizeFusion(runs, null, null).roles.find(([role]) => role === "primary")?.[1], 200);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
