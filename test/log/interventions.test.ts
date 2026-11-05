import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { elapsedMs, parseInterventions, summarizeInterventions } from "../../src/log/interventions";
import { parseEventsJsonl, readCliStats } from "../../src/log/cliLogReader";

suite("CLI permission observations", () => {
  const event = (type: string, timestamp: string, data: object, id?: string) =>
    JSON.stringify({ type, timestamp, data, id });
  const request = (id: string, timestamp: string, kind = "shell") =>
    event("permission.requested", timestamp, {
      requestId: id,
      permissionRequest: { kind, toolCallId: "tool-1", arguments: "secret" },
    });
  const response = (id: string, timestamp: string, decisionSource: string | undefined, kind = "approved") =>
    event("permission.completed", timestamp, {
      requestId: id,
      decisionSource,
      result: { kind, reason: "Session aborted" },
    });
  const date = (day: string, time = "00:00:00") => `2026-01-${day}T${time}.000Z`;

  test("joins out of order, deduplicates, separates source and outcome, and omits arguments", () => {
    const content = [
      response("a", date("02"), "human_response"),
      request("a", date("01")),
      request("a", date("01")),
      response("b", date("02"), "host_policy"),
      request("b", date("02"), "read"),
      response("c", date("02"), undefined, "cancelled"),
      response("d", date("02"), "new_source", "new_result"),
      request("e", date("02")),
      event("tool.execution_start", date("01"), { toolCallId: "tool-1", toolName: "shell" }),
    ].join("\n");
    const data = parseInterventions(content);
    assert.strictEqual(data.permissions.length, 5);
    assert.deepStrictEqual(
      data.permissions.map((p) => [p.decisionSource, p.result]),
      [
        ["human_response", "approved"],
        ["host_policy", "approved"],
        [null, "cancelled"],
        [null, null],
        [null, null],
      ],
    );
    assert.strictEqual(data.permissions[0].toolName, "shell");
    assert.strictEqual(data.permissions[2].requestRecorded, false);
    assert.strictEqual(data.permissions[4].responseRecorded, false);
    assert.ok(!JSON.stringify(data).includes("secret"));
  });

  test("uses response date, valid elapsed samples, and permission-session denominator", () => {
    const one = parseInterventions(
      [
        request("same", date("01")),
        response("same", date("02"), "human_response"),
        request("long", date("01")),
        response("long", date("04"), "human_response"),
        request("negative", date("03")),
        response("negative", date("02"), "human_response"),
        request("bad", "invalid"),
        response("bad", date("02"), "human_response"),
        event("user.message", date("02"), { delivery: "steering" }),
        event("user.message", date("02"), { delivery: "idle" }),
        event("abort", date("02"), { reason: "user_initiated" }),
        event("abort", date("02"), { reason: "subagent_cancelled" }),
      ].join("\n"),
    );
    const two = parseInterventions(
      [request("same", date("02"), "read"), response("same", date("02", "00:00:10"), "host_policy")].join("\n"),
    );
    const summary = summarizeInterventions(
      [{ interventions: one }, { interventions: two }, {}],
      "2026-01-02",
      "2026-01-04",
    );
    assert.deepStrictEqual(
      [
        summary.human,
        summary.humanSessions,
        summary.observedSessions,
        summary.samples,
        summary.median,
        summary.steering,
        summary.stops,
      ],
      [4, 1, 2, 2, 172800000, 1, 1],
    );
    assert.strictEqual(elapsedMs(one.permissions.find((p) => p.requestId === "negative")!), null);
    assert.deepStrictEqual(summarizeInterventions([{ interventions: one }], "2026-01-02", "2026-01-02").counts, [
      ["shell", 3],
    ]);
  });

  test("permission events do not alter existing usage or Fusion", () => {
    const base = [
      event("session.start", date("01"), { sessionId: "s" }),
      event("session.usage_record", date("01"), {
        usage: { inputTokens: 10, outputTokens: 4, copilotUsage: { totalNanoAiu: 100 } },
      }),
    ].join("\n");
    const before = parseEventsJsonl(base);
    const after = parseEventsJsonl(
      `${base}\n${request("a", date("01"))}\n${response("a", date("02"), "human_response")}`,
    );
    assert.deepStrictEqual(after.usage, before.usage);
    assert.deepStrictEqual(after.thread?.fusionRuns, before.thread?.fusionRuns);
    assert.deepStrictEqual([...after.byDate], [...before.byDate]);
  });
  test("merges repeated session files without merging equal request IDs in different sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "permissions-"));
    try {
      const write = async (folder: string, session: string, lines: string[]) => {
        await fs.mkdir(path.join(root, folder));
        await fs.writeFile(
          path.join(root, folder, "events.jsonl"),
          [event("session.start", date("01"), { sessionId: session }), ...lines].join("\n"),
        );
      };
      const req = event(
        "permission.requested",
        date("01"),
        { requestId: "same", permissionRequest: { kind: "shell" } },
        "request-event",
      );
      const res = event(
        "permission.completed",
        date("02"),
        { requestId: "same", decisionSource: "human_response", result: { kind: "approved" } },
        "response-event",
      );
      await write("a", "session-a", [req]);
      await write("b", "session-a", [req, res]);
      await write("c", "session-b", [request("same", date("01")), response("same", date("02"), "human_response")]);
      const stats = await readCliStats(root);
      const summary = summarizeInterventions(stats.threads, null, null);
      assert.deepStrictEqual([summary.human, summary.humanSessions, summary.observedSessions], [2, 2, 2]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
