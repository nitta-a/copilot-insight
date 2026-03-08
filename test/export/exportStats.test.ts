import * as assert from "assert";
import { exportAsCsv, exportAsJson } from "../../src/export/exportStats";
import type { CopilotUsageStats } from "../../src/types";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 100,
    totalAccepted: 70,
    totalRejected: 30,
    totalChat: 15,
    acceptanceRate: 70.0,
    avgLatencyMs: 250,
    byDate: new Map([
      ["2026-02-27", { shown: 50, accepted: 35 }],
      ["2026-02-28", { shown: 50, accepted: 35 }],
    ]),
    byModel: new Map([["gpt-4", { shown: 80, accepted: 60 }]]),
    byChatModel: new Map([["gpt-4o", 15]]),
    byHour: new Map([["10", 30]]),
    byChatIntent: new Map([["Agent", 10]]),
    logFilesFound: 5,
    chatByDate: new Map([
      ["2026-02-27", 7],
      ["2026-02-28", 8],
    ]),
    chatByHour: new Map([["10", 5]]),
    totalErrors: 2,
    errorsByType: new Map([["HTTP 429", 2]]),
    latencies: [100, 200, 300],
    chatLatencies: [150, 250],
    latencyP50: 200,
    latencyP95: 300,
    latencyP99: 300,
    chatAvgLatencyMs: 200,
    chatLatencyP50: 150,
    chatLatencyP95: 250,
    bySession: new Map([
      ["session-1", { sessionId: "session-1", shown: 60, accepted: 40, chat: 10, errors: 1 }],
      ["session-2", { sessionId: "session-2", shown: 40, accepted: 30, chat: 5, errors: 1 }],
    ]),
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
    byDateAgenticDepth: new Map(),
    planCount: 0,
    executedPlanCount: 0,
    userChoicesInPlan: 0,
    browserToolInvocations: 0,
    browserToolsByType: new Map(),
    pluginOrSkillInvocations: 0,
    pluginOrSkillByName: new Map(),
    memoryManagementEvents: [],
    sessionSignals: [],
    memoryManagementByType: new Map(),
    agentDebugEvents: 0,
    agentDebugByType: new Map(),
    ...overrides,
  };
}

suite("exportStats", () => {
  suite("exportAsCsv", () => {
    test("contains summary section with correct values", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Summary"), "Should contain Summary header");
      assert.ok(csv.includes("Total Shown,100"), "Should contain total shown");
      assert.ok(csv.includes("Total Accepted,70"), "Should contain total accepted");
      assert.ok(csv.includes("Acceptance Rate,70.0%"), "Should contain acceptance rate");
      assert.ok(csv.includes("Total Chat,15"), "Should contain total chat");
      assert.ok(csv.includes("Log Files Parsed,5"), "Should contain log files count");
    });

    test("contains date section sorted chronologically", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# By Date"), "Should contain date header");
      const dateLines = csv.split("\n").filter((l) => l.startsWith("2026-"));
      assert.strictEqual(dateLines.length, 2);
      assert.ok(dateLines[0].startsWith("2026-02-27"), "First date should be earlier");
      assert.ok(dateLines[1].startsWith("2026-02-28"), "Second date should be later");
    });

    test("includes chat count in date rows", () => {
      const csv = exportAsCsv(makeStats());
      const dateLine = csv.split("\n").find((l) => l.startsWith("2026-02-27"));
      assert.ok(dateLine);
      assert.ok(dateLine.endsWith(",7"), "Should end with chat count 7");
    });

    test("includes model section with rate", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Inline Completion Model"));
      assert.ok(csv.includes("Model,Shown,Accepted,Rate"));
      assert.ok(csv.includes("gpt-4,80,60,75.0%"));
    });

    test("includes chat model section", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Chat Model"));
      assert.ok(csv.includes("gpt-4o,15"));
    });

    test("includes session section", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Sessions"));
      assert.ok(csv.includes("Session,Shown,Accepted,Rate,Chat,Errors"));
    });

    test("includes errors section when errors exist", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Errors by Type"));
      assert.ok(csv.includes("HTTP 429,2"));
    });

    test("omits errors section when no errors", () => {
      const csv = exportAsCsv(makeStats({ totalErrors: 0, errorsByType: new Map() }));
      assert.ok(!csv.includes("# Errors by Type"));
    });

    test("omits model sections when empty", () => {
      const csv = exportAsCsv(makeStats({ byModel: new Map(), byChatModel: new Map() }));
      assert.ok(!csv.includes("# Inline Completion Model"));
      assert.ok(!csv.includes("# Chat Model"));
    });

    test("includes chat intent section", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Chat Intent"), "Should contain chat intent header");
      assert.ok(csv.includes("Intent,Count"), "Should contain intent CSV header");
      assert.ok(csv.includes("Agent,10"), "Should contain Agent intent row");
    });

    test("includes activity by hour section", () => {
      const csv = exportAsCsv(makeStats());
      assert.ok(csv.includes("# Activity by Hour"), "Should contain hourly header");
      assert.ok(csv.includes("Hour,Inline,Chat"), "Should contain hourly CSV header");
      assert.ok(csv.includes("10,30,5"), "Should contain hour 10 with inline=30, chat=5");
      assert.ok(csv.includes("00,0,0"), "Should contain hour 00 with zeros");
    });

    test("omits chat intent section when empty", () => {
      const csv = exportAsCsv(makeStats({ byChatIntent: new Map() }));
      assert.ok(!csv.includes("# Chat Intent"));
    });

    test("omits hourly section when both maps are empty", () => {
      const csv = exportAsCsv(makeStats({ byHour: new Map(), chatByHour: new Map() }));
      assert.ok(!csv.includes("# Activity by Hour"));
    });

    test("includes feature signal sections when present", () => {
      const csv = exportAsCsv(
        makeStats({
          browserToolInvocations: 2,
          browserToolsByType: new Map([["screenshot", 2]]),
          memoryManagementEvents: [
            {
              timestamp: "2026-03-07T10:00:00Z",
              type: "compact",
              rawText: "/compact",
              sessionId: "session-1",
            },
          ],
          memoryManagementByType: new Map([["compact", 1]]),
        }),
      );
      assert.ok(csv.includes("# Browser Tool Signals"));
      assert.ok(csv.includes("screenshot,2"));
      assert.ok(csv.includes("# Session Memory Signals"));
      assert.ok(csv.includes("compact,1"));
    });
  });

  suite("exportAsJson", () => {
    test("returns valid JSON", () => {
      const json = exportAsJson(makeStats());
      const parsed = JSON.parse(json);
      assert.ok(parsed, "Should be parseable JSON");
    });

    test("contains summary with correct values", () => {
      const parsed = JSON.parse(exportAsJson(makeStats()));
      assert.strictEqual(parsed.summary.totalShown, 100);
      assert.strictEqual(parsed.summary.totalAccepted, 70);
      assert.strictEqual(parsed.summary.acceptanceRate, 70.0);
      assert.strictEqual(parsed.summary.totalChat, 15);
      assert.strictEqual(parsed.summary.totalErrors, 2);
      assert.strictEqual(parsed.summary.logFilesFound, 5);
    });

    test("merges chat count into byDate entries", () => {
      const parsed = JSON.parse(exportAsJson(makeStats()));
      const dateEntry = parsed.byDate["2026-02-27"];
      assert.ok(dateEntry, "Should have date entry");
      assert.strictEqual(dateEntry.shown, 50);
      assert.strictEqual(dateEntry.accepted, 35);
      assert.strictEqual(dateEntry.chat, 7);
    });

    test("converts model maps to objects", () => {
      const parsed = JSON.parse(exportAsJson(makeStats()));
      assert.deepStrictEqual(parsed.byModel["gpt-4"], { shown: 80, accepted: 60 });
      assert.strictEqual(parsed.byChatModel["gpt-4o"], 15);
    });

    test("includes sessions array sorted by sessionId descending", () => {
      const parsed = JSON.parse(exportAsJson(makeStats()));
      assert.ok(Array.isArray(parsed.sessions));
      assert.strictEqual(parsed.sessions.length, 2);
      assert.strictEqual(parsed.sessions[0].sessionId, "session-2");
      assert.strictEqual(parsed.sessions[1].sessionId, "session-1");
    });

    test("handles empty maps gracefully", () => {
      const stats = makeStats({
        byModel: new Map(),
        byChatModel: new Map(),
        bySession: new Map(),
        errorsByType: new Map(),
      });
      const parsed = JSON.parse(exportAsJson(stats));
      assert.deepStrictEqual(parsed.byModel, {});
      assert.strictEqual(parsed.sessions.length, 0);
    });

    test("includes featureSignals object", () => {
      const parsed = JSON.parse(
        exportAsJson(
          makeStats({
            pluginOrSkillInvocations: 2,
            pluginOrSkillByName: new Map([["code-search", 2]]),
          }),
        ),
      );
      assert.strictEqual(parsed.featureSignals.pluginOrSkills.total, 2);
      assert.strictEqual(parsed.featureSignals.pluginOrSkills.breakdown["code-search"], 2);
    });
  });
});
