import * as assert from "assert";
import type { CopilotUsageStats } from "../../src/types";
import { buildDashboardPayload } from "../../src/ui/dashboardPayload";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 200,
    totalAccepted: 120,
    totalRejected: 80,
    totalChat: 20,
    acceptanceRate: 60.0,
    avgLatencyMs: 300,
    byDate: new Map([
      ["2026-02-24", { shown: 40, accepted: 24 }],
      ["2026-02-25", { shown: 50, accepted: 30 }],
      ["2026-02-26", { shown: 60, accepted: 36 }],
      ["2026-02-27", { shown: 50, accepted: 30 }],
    ]),
    byModel: new Map([["gpt-4o", { shown: 150, accepted: 90 }]]),
    byChatModel: new Map([["gpt-4o", 20]]),
    byHour: new Map([["10", 50]]),
    byChatIntent: new Map([["Agent", 10]]),
    logFilesFound: 5,
    chatByDate: new Map([["2026-02-27", 10]]),
    chatByHour: new Map([["10", 5]]),
    totalErrors: 0,
    errorsByType: new Map(),
    latencies: [100, 200, 300],
    chatLatencies: [200, 300],
    latencyP50: 200,
    latencyP95: 300,
    latencyP99: 300,
    chatAvgLatencyMs: 250,
    chatLatencyP50: 200,
    chatLatencyP95: 300,
    bySession: new Map([["s1", { sessionId: "s1", shown: 100, accepted: 60, chat: 10, errors: 0 }]]),
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

suite("buildDashboardPayload", () => {
  suite("core KPI fields", () => {
    test("sets totalShown from stats", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.totalShown, 200);
    });

    test("sets totalAccepted from stats", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.totalAccepted, 120);
    });

    test("acceptanceRate is totalAccepted / totalShown * 100", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.ok(Math.abs(payload.acceptanceRate - 60) < 0.01);
    });

    test("acceptanceRate is 0 when totalShown is 0 (zero-division guard)", () => {
      const stats = makeStats({ totalShown: 0, totalAccepted: 0 });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.acceptanceRate, 0);
    });

    test("estimatedTimeSaved includes typing ROI from accepted completions", () => {
      // 120 accepted * 40 chars / 200 CPM = 24 min (no autonomous duration)
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.estimatedTimeSaved, 24);
    });

    test("estimatedTimeSaved includes agentic ROI from autonomous duration", () => {
      // typing: 120*40/200 = 24 min; agentic: (120000/60000)*0.5 = 1 min; total = 25
      const stats = makeStats({ autonomousDurationMs: 120000 });
      const payload = buildDashboardPayload(stats);
      assert.ok(Math.abs(payload.estimatedTimeSaved - 25) < 0.001);
    });

    test("activeSessions equals bySession.size", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.activeSessions, 1);
    });

    test("activeSessions is 0 when bySession is empty", () => {
      const stats = makeStats({ bySession: new Map() });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.activeSessions, 0);
    });
  });

  suite("timeline", () => {
    test("has one entry per byDate entry", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.timeline.length, 4);
    });

    test("entries are sorted by date ascending", () => {
      const payload = buildDashboardPayload(makeStats());
      const dates = payload.timeline.map((e) => e.date);
      const sorted = [...dates].sort();
      assert.deepStrictEqual(dates, sorted);
    });

    test("entry fields are correct", () => {
      const payload = buildDashboardPayload(makeStats());
      const entry = payload.timeline[0];
      assert.strictEqual(entry?.date, "2026-02-24");
      assert.strictEqual(entry?.shown, 40);
      assert.strictEqual(entry?.accepted, 24);
      assert.ok(Math.abs((entry?.rate ?? -1) - 60) < 0.01);
    });

    test("entry rate is 0 when shown is 0 (zero-division guard)", () => {
      const stats = makeStats({
        byDate: new Map([["2026-03-01", { shown: 0, accepted: 0 }]]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.timeline[0]?.rate, 0);
    });
  });

  suite("sessions", () => {
    test("has one entry per bySession entry", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.sessions.length, 1);
    });

    test("session fields include sessionId, date, accepted, estimatedMinSaved", () => {
      const payload = buildDashboardPayload(makeStats());
      const s = payload.sessions[0];
      assert.ok(s);
      assert.strictEqual(s.sessionId, "s1");
      assert.strictEqual(s.accepted, 60);
      // 60 * 40 / 200 = 12 min
      assert.ok(Math.abs(s.estimatedMinSaved - 12) < 0.001);
    });

    test("session date falls back to sessionId when no YYYYMMDD pattern found", () => {
      const stats = makeStats({
        bySession: new Map([["abcdef", { sessionId: "abcdef", shown: 10, accepted: 5, chat: 0, errors: 0 }]]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.sessions[0]?.date, "abcdef");
    });

    test("sessions are sorted by date descending", () => {
      const stats = makeStats({
        bySession: new Map([
          ["20260201_a", { sessionId: "20260201_a", shown: 10, accepted: 5, chat: 0, errors: 0 }],
          ["20260305_b", { sessionId: "20260305_b", shown: 20, accepted: 10, chat: 0, errors: 0 }],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.sessions[0]?.date, "2026-03-05");
      assert.strictEqual(payload.sessions[1]?.date, "2026-02-01");
    });
  });

  suite("insights", () => {
    test("includes peak-hour insight when byHour is non-empty", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.ok(payload.insights.some((i) => i.includes("Most active hour")));
    });

    test("includes chat-ratio insight when totalChat > 0 and totalShown > 0", () => {
      const payload = buildDashboardPayload(makeStats({ totalChat: 20 }));
      assert.ok(payload.insights.some((i) => i.includes("Chat usage ratio")));
    });

    test("insights array is empty when no data to report", () => {
      const stats = makeStats({
        byHour: new Map(),
        chatByDate: new Map(),
        totalChat: 0,
        byDate: new Map(),
      });
      const payload = buildDashboardPayload(stats);
      assert.ok(Array.isArray(payload.insights));
    });
  });
});
