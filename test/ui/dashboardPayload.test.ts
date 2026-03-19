import * as assert from "assert";
import type { SessionSignalEvent } from "../../src/events/eventSchema";
import type { TrueAcceptanceResult, VelocityAnalysisResult } from "../../src/metrics/metricsEngine";
import type { CopilotUsageStats, RefreshAnalysis, SessionSummary } from "../../src/types";
import { buildDashboardPayload } from "../../src/ui/dashboardPayload";

function fmt(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function makeRefreshAnalysis(overrides?: Partial<RefreshAnalysis>): RefreshAnalysis {
  return {
    event: {
      timestamp: "2026-03-07T10:00:00Z",
      type: "compact",
      rawText: "/compact",
      sessionId: "s1",
    },
    windowMinutes: 15,
    turnWindowSize: 10,
    preWindow: {
      turnCount: 3,
      rawAccepted: 3,
      trueAccepted: 2,
      rawRate: 100,
      trueRate: 66.7,
      revertedCount: 1,
      windowStart: "2026-03-07T09:45:00Z",
      windowEnd: "2026-03-07T09:59:00Z",
    },
    postWindow: {
      turnCount: 3,
      rawAccepted: 3,
      trueAccepted: 3,
      rawRate: 100,
      trueRate: 100,
      revertedCount: 0,
      windowStart: "2026-03-07T10:01:00Z",
      windowEnd: "2026-03-07T10:15:00Z",
    },
    preTurns: {
      turnCount: 2,
      rawAccepted: 2,
      trueAccepted: 1,
      rawRate: 100,
      trueRate: 50,
      revertedCount: 1,
      windowStart: "2026-03-07T09:58:00Z",
      windowEnd: "2026-03-07T09:59:00Z",
    },
    postTurns: {
      turnCount: 2,
      rawAccepted: 2,
      trueAccepted: 2,
      rawRate: 100,
      trueRate: 100,
      revertedCount: 0,
      windowStart: "2026-03-07T10:01:00Z",
      windowEnd: "2026-03-07T10:02:00Z",
    },
    recoveryDelta: 50,
    refreshRoi: 1,
    ...overrides,
  };
}

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
    cliByDate: new Map(),
    cliTotalInteractions: 0,
    commandUsage: new Map(),
    promptEffectiveness: {},
    chatSessionStates: new Map(),
    ...overrides,
  };
}

function makeSessionSignal(overrides?: Partial<SessionSignalEvent>): SessionSignalEvent {
  return {
    sessionId: "s1",
    timestamp: "2026-03-07T10:00:00Z",
    eventType: "sessionSignal",
    languageId: "typescript",
    signalType: "chat-request",
    actor: "human",
    phase: "human",
    intent: "vscodePrompt",
    rawText: "prompt",
    modelName: "gpt-4o",
    latencyMs: 0,
    success: true,
    ...overrides,
  };
}

suite("buildDashboardPayload", () => {
  suite("summary", () => {
    test("sets totalShown, totalAccepted, acceptanceRate from stats", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.summary.totalShown, 200);
      assert.strictEqual(payload.summary.totalAccepted, 120);
      assert.strictEqual(payload.summary.acceptanceRate, 60.0);
    });

    test("trueAcceptanceRate is null when no trueAcceptance passed", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.summary.trueAcceptanceRate, null);
    });

    test("trueAcceptanceRate comes from trueAcceptance.trueRate", () => {
      const ta: TrueAcceptanceResult = {
        rawAccepted: 120,
        trueAccepted: 100,
        rawRate: 60,
        trueRate: 50,
        revertedCount: 20,
      };
      const payload = buildDashboardPayload(makeStats(), ta);
      assert.strictEqual(payload.summary.trueAcceptanceRate, 50);
    });

    test("estimatedMinutesSaved is acceptedCount * 40 chars / 200 CPM", () => {
      const payload = buildDashboardPayload(makeStats());
      // 120 * 40 / 200 = 24 (no autonomous duration)
      assert.strictEqual(payload.summary.estimatedMinutesSaved, 24);
    });

    test("typingMinutesSaved is acceptedCount * 40 chars / 200 CPM", () => {
      const payload = buildDashboardPayload(makeStats());
      // 120 * 40 / 200 = 24
      assert.strictEqual(payload.summary.typingMinutesSaved, 24);
    });

    test("agenticMinutesSaved is autonomousDurationMs / 60000 * 0.5", () => {
      const stats = makeStats({ autonomousDurationMs: 12000 }); // 12s = 0.2min
      const payload = buildDashboardPayload(stats);
      // (12000 / 60000) * 0.5 = 0.1
      assert.ok(Math.abs(payload.summary.agenticMinutesSaved - 0.1) < 0.0001);
    });

    test("estimatedMinutesSaved equals typingMinutesSaved + agenticMinutesSaved", () => {
      const stats = makeStats({ autonomousDurationMs: 60000 }); // 1min autonomous
      const payload = buildDashboardPayload(stats);
      assert.ok(
        Math.abs(
          payload.summary.estimatedMinutesSaved -
            (payload.summary.typingMinutesSaved + payload.summary.agenticMinutesSaved),
        ) < 0.0001,
      );
    });

    test("totalMinutesSaved is a RoiBreakdown with total, editor, cli", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(typeof payload.summary.totalMinutesSaved, "object");
      assert.strictEqual(payload.summary.totalMinutesSaved.total, payload.summary.estimatedMinutesSaved);
      assert.strictEqual(payload.summary.totalMinutesSaved.editor, payload.summary.estimatedMinutesSaved);
      assert.strictEqual(payload.summary.totalMinutesSaved.cli, 0);
    });

    test("totalMinutesSaved.total equals editor + cli", () => {
      const stats = makeStats({ autonomousDurationMs: 120000 });
      const payload = buildDashboardPayload(stats);
      assert.ok(
        Math.abs(
          payload.summary.totalMinutesSaved.total -
            (payload.summary.totalMinutesSaved.editor + payload.summary.totalMinutesSaved.cli),
        ) < 0.0001,
      );
    });

    test("topChatModel uses the most requested non-inline model from byChatModel", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.summary.topChatModel, "gpt-4o");
      assert.strictEqual(payload.summary.topChatModelCount, 20);
    });

    test("topChatModel picks the model with the highest request count", () => {
      const stats = makeStats({
        byChatModel: new Map([
          ["gpt-4o", 10],
          ["claude-3.5", 12],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topChatModel, "claude-3.5");
      assert.strictEqual(payload.summary.topChatModelCount, 12);
    });

    test("topChatModel is returned even for low request counts", () => {
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 4]]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topChatModel, "gpt-4o");
      assert.strictEqual(payload.summary.topChatModelCount, 4);
    });

    test("topChatModel is null when byChatModel is empty", () => {
      const stats = makeStats({ byChatModel: new Map() });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topChatModel, null);
      assert.strictEqual(payload.summary.topChatModelCount, 0);
    });

    test("topChatModel works with normalized non-inline model names", () => {
      const stats = makeStats({
        byChatModel: new Map([
          ["claude-sonnet-4.6 -> claude-sonnet-4-6", 12],
          ["gpt-4o", 8],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topChatModel, "claude-sonnet-4.6");
      assert.strictEqual(payload.summary.topChatModelCount, 12);
    });

    test("topChatModel breaks equal-count ties alphabetically", () => {
      const stats = makeStats({
        byChatModel: new Map([
          ["gpt-4o", 10],
          ["claude-3.5", 10],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topChatModel, "claude-3.5");
      assert.strictEqual(payload.summary.topChatModelCount, 10);
    });

    test("topAskModel combines Ask and old Ask requests", () => {
      const stats = makeStats({
        sessionSignals: [
          makeSessionSignal({ intent: "vscodePrompt", modelName: "gpt-4o" }),
          makeSessionSignal({ intent: "copilotLanguageModelWrapper", modelName: "gpt-4o" }),
          makeSessionSignal({ intent: "vscodePrompt", modelName: "claude-3.5" }),
        ],
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topAskModel, "gpt-4o");
      assert.strictEqual(payload.summary.topAskModelCount, 2);
    });

    test("topAskModel ignores non-Ask intents and blank model names", () => {
      const stats = makeStats({
        sessionSignals: [
          makeSessionSignal({ intent: "Agent", modelName: "claude-3.5" }),
          makeSessionSignal({ intent: "vscodePrompt", modelName: "   " }),
        ],
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topAskModel, null);
      assert.strictEqual(payload.summary.topAskModelCount, 0);
    });

    test("topPlanModel counts plan-proposal and panel/editAgent signals", () => {
      const stats = makeStats({
        sessionSignals: [
          makeSessionSignal({ signalType: "plan-proposal", modelName: "o3", intent: "panel/unknown" }),
          makeSessionSignal({ signalType: "plan-proposal", modelName: "o3", intent: "panel/unknown" }),
          makeSessionSignal({ signalType: "plan-proposal", modelName: "", intent: "agent/plan" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "claude-3.5", intent: "vscodePrompt" }),
        ],
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topPlanModel, "o3");
      assert.strictEqual(payload.summary.topPlanModelCount, 2);
    });

    test("topPlanModel counts modern panel/editAgent chat-request signals", () => {
      const stats = makeStats({
        sessionSignals: [
          makeSessionSignal({ signalType: "chat-request", modelName: "claude-sonnet-4.6", intent: "panel/editAgent" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "claude-sonnet-4.6", intent: "panel/editAgent" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "claude-sonnet-4.6", intent: "panel/editAgent" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "o3", intent: "panel/editAgent" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "o3", intent: "vscodePrompt" }),
        ],
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topPlanModel, "claude-sonnet-4.6");
      assert.strictEqual(payload.summary.topPlanModelCount, 3);
    });

    test("topPlanModel mixes legacy plan-proposal and modern panel/editAgent", () => {
      const stats = makeStats({
        sessionSignals: [
          makeSessionSignal({ signalType: "plan-proposal", modelName: "o3", intent: "panel/unknown" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "claude-sonnet-4.6", intent: "panel/editAgent" }),
          makeSessionSignal({ signalType: "chat-request", modelName: "claude-sonnet-4.6", intent: "panel/editAgent" }),
        ],
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topPlanModel, "claude-sonnet-4.6");
      assert.strictEqual(payload.summary.topPlanModelCount, 2);
    });

    test("topPlanModel breaks equal-count ties alphabetically", () => {
      const stats = makeStats({
        sessionSignals: [
          makeSessionSignal({ signalType: "plan-proposal", modelName: "o3", intent: "panel/unknown" }),
          makeSessionSignal({ signalType: "plan-proposal", modelName: "claude-3.5", intent: "panel/unknown" }),
        ],
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.summary.topPlanModel, "claude-3.5");
      assert.strictEqual(payload.summary.topPlanModelCount, 1);
    });

    test("sessionSummaries are forwarded into the payload", () => {
      const summaries: SessionSummary[] = [
        {
          sessionId: "s1",
          title: "Investigate session explorer",
          date: "2026-03-07",
          totalActions: 12,
          trueRate: 58.5,
          autonomousDuration: 12_000,
          efficiencyScore: 63.2,
        },
      ];
      const payload = buildDashboardPayload(makeStats(), undefined, undefined, undefined, [], summaries);
      assert.deepStrictEqual(payload.sessionSummaries, summaries);
    });

    test("fallback session summaries are shown with date as title when no explicit sessions are available", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.sessionSummaries.length, 1);
      assert.strictEqual(payload.sessionSummaries[0]?.sessionId, "s1");
      assert.ok(payload.sessionSummaries[0]?.title, "fallback session should have a non-empty title");
    });

    test("freshness is null when refresh analysis is unavailable", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.freshness, null);
      assert.deepStrictEqual(payload.refreshAnalysis, []);
    });
  });

  suite("timeline", () => {
    test("timeline includes all dates", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.timeline.length, 4);
    });

    test("timeline is sorted by date ascending", () => {
      const payload = buildDashboardPayload(makeStats());
      const dates = payload.timeline.map((e) => e.date);
      const sorted = [...dates].sort();
      assert.deepStrictEqual(dates, sorted);
    });

    test("timeline entry rate is calculated correctly", () => {
      const payload = buildDashboardPayload(makeStats());
      const entry = payload.timeline[0];
      assert.ok(entry);
      const expectedRate = (entry.accepted / entry.shown) * 100;
      assert.ok(Math.abs(entry.rate - expectedRate) < 0.001);
    });

    test("timeline trueAccepted is null (not available per day)", () => {
      const payload = buildDashboardPayload(makeStats());
      for (const entry of payload.timeline) {
        assert.strictEqual(entry.trueAccepted, null);
      }
    });

    test("days field in payload equals timeline length", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.days, payload.timeline.length);
    });

    test("timeline entries include source-category breakdown fields", () => {
      const payload = buildDashboardPayload(makeStats());
      for (const entry of payload.timeline) {
        assert.strictEqual(entry.editorShown, entry.shown);
        assert.strictEqual(entry.editorAccepted, entry.accepted);
        assert.strictEqual(entry.cliShown, 0);
        assert.strictEqual(entry.cliAccepted, 0);
      }
    });

    test("timeline chatCount maps from chatByDate", () => {
      const stats = makeStats({
        chatByDate: new Map([
          ["2026-02-26", 5],
          ["2026-02-27", 10],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const feb26 = payload.timeline.find((e) => e.date === "2026-02-26");
      const feb25 = payload.timeline.find((e) => e.date === "2026-02-25");
      assert.strictEqual(feb26?.chatCount, 5);
      assert.strictEqual(feb25?.chatCount, 0);
    });
  });

  suite("availableRange", () => {
    test("availableRange reflects full span of stats.byDate", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.availableRange.minDate, "2026-02-24");
      assert.strictEqual(payload.availableRange.maxDate, "2026-02-27");
    });

    test("availableRange is empty strings when byDate is empty", () => {
      const stats = makeStats({ byDate: new Map() });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.availableRange.minDate, "");
      assert.strictEqual(payload.availableRange.maxDate, "");
    });
  });

  suite("velocityPoints", () => {
    test("velocityPoints is empty when no velocity passed", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.velocityPoints.length, 0);
    });

    test("velocityPoints maps timeSeries entries", () => {
      const velocity: VelocityAnalysisResult = {
        timeSeries: [
          { windowStart: "2026-02-27T10:00:00Z", kpm: 120, completionsAccepted: 3, flowDisrupted: false },
          { windowStart: "2026-02-27T10:01:00Z", kpm: 40, completionsAccepted: 2, flowDisrupted: true },
        ],
        averageKpm: 80,
        disruptionCount: 1,
      };
      const payload = buildDashboardPayload(makeStats(), undefined, velocity);
      assert.strictEqual(payload.velocityPoints.length, 2);
      assert.strictEqual(payload.velocityPoints[0].kpm, 120);
      assert.strictEqual(payload.velocityPoints[0].flowDisrupted, false);
      assert.strictEqual(payload.velocityPoints[1].flowDisrupted, true);
    });
  });

  suite("context freshness", () => {
    test("stays at 100% through the first 50 actions", () => {
      const stats = makeStats({
        bySession: new Map([["s2", { sessionId: "s2", shown: 20, accepted: 10, chat: 5, errors: 0 }]]),
      });
      const payload = buildDashboardPayload(stats, undefined, undefined, undefined, [makeRefreshAnalysis()]);
      assert.ok(payload.freshness);
      assert.strictEqual(payload.freshness?.score, 100);
      assert.strictEqual(payload.freshness?.status, "fresh");
    });

    test("decays after 50 actions and exposes refresh analysis", () => {
      const stats = makeStats({
        bySession: new Map([["s2", { sessionId: "s2", shown: 45, accepted: 20, chat: 8, errors: 0 }]]),
      });
      const trueAcceptance: TrueAcceptanceResult = {
        rawAccepted: 120,
        trueAccepted: 84,
        rawRate: 60,
        trueRate: 42,
        revertedCount: 36,
      };
      const refreshAnalysis = [makeRefreshAnalysis({ refreshRoi: 0.25, recoveryDelta: 18 })];
      const payload = buildDashboardPayload(stats, trueAcceptance, undefined, undefined, refreshAnalysis);
      assert.ok(payload.freshness);
      assert.ok((payload.freshness?.score ?? 0) < 100);
      assert.strictEqual(payload.freshness?.suggestedAction, "compact");
      assert.strictEqual(payload.refreshAnalysis.length, 1);
      assert.strictEqual(payload.freshness?.latestRefreshRoi, 0.25);
    });

    test("preserves refresh analysis entries for overview history rendering", () => {
      const refreshAnalysis = [
        makeRefreshAnalysis(),
        makeRefreshAnalysis({ event: { ...makeRefreshAnalysis().event, timestamp: "2026-03-07T11:00:00Z" } }),
      ];
      const payload = buildDashboardPayload(makeStats(), undefined, undefined, undefined, refreshAnalysis);
      assert.strictEqual(payload.refreshAnalysis.length, 2);
      assert.strictEqual(payload.refreshAnalysis[0].event.type, "compact");
      assert.strictEqual(payload.refreshAnalysis[1].event.timestamp, "2026-03-07T11:00:00Z");
    });
  });

  suite("evolutionData", () => {
    test("maps byDateAgenticDepth into sorted autonomy evolution points", () => {
      const stats = makeStats({
        byDateAgenticDepth: new Map([
          [
            "2026-02-27",
            {
              loopDistribution: { bucket1: 0, bucket2: 1, bucket3to5: 0, bucket6to10: 0, bucket11plus: 0 },
              avgLoopActions: 2,
              completionRate: 50,
              velocityMsPerAction: 30000,
            },
          ],
          [
            "2026-02-26",
            {
              loopDistribution: { bucket1: 1, bucket2: 0, bucket3to5: 1, bucket6to10: 0, bucket11plus: 0 },
              avgLoopActions: 3,
              completionRate: 100,
              velocityMsPerAction: 10000,
            },
          ],
        ]),
      });

      const payload = buildDashboardPayload(stats);
      assert.deepStrictEqual(
        payload.evolutionData.map((point) => point.date),
        ["2026-02-26", "2026-02-27"],
      );
      assert.strictEqual(payload.evolutionData[0].avgDepth, 3);
      assert.strictEqual(payload.evolutionData[0].totalDurationMin, 1);
      assert.strictEqual(payload.evolutionData[0].completionRate, 100);
      assert.strictEqual(payload.evolutionData[1].totalDurationMin, 1);
    });

    test("does not synthesize missing dates in evolutionData", () => {
      const stats = makeStats({
        byDateAgenticDepth: new Map([
          [
            "2026-02-24",
            {
              loopDistribution: { bucket1: 1, bucket2: 0, bucket3to5: 0, bucket6to10: 0, bucket11plus: 0 },
              avgLoopActions: 1,
              completionRate: 100,
              velocityMsPerAction: 5000,
            },
          ],
          [
            "2026-02-27",
            {
              loopDistribution: { bucket1: 0, bucket2: 1, bucket3to5: 0, bucket6to10: 0, bucket11plus: 0 },
              avgLoopActions: 2,
              completionRate: 100,
              velocityMsPerAction: 10000,
            },
          ],
        ]),
      });

      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.evolutionData.length, 2);
      assert.deepStrictEqual(
        payload.evolutionData.map((point) => point.date),
        ["2026-02-24", "2026-02-27"],
      );
    });

    test("adds complex-task insight when avg depth grows more than 20% week over week", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thisMonday = getMonday(today);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);

      const stats = makeStats({
        byDateAgenticDepth: new Map([
          [
            fmt(lastMonday),
            {
              loopDistribution: { bucket1: 0, bucket2: 1, bucket3to5: 0, bucket6to10: 0, bucket11plus: 0 },
              avgLoopActions: 2,
              completionRate: 100,
              velocityMsPerAction: 5000,
            },
          ],
          [
            fmt(thisMonday),
            {
              loopDistribution: { bucket1: 0, bucket2: 0, bucket3to5: 1, bucket6to10: 0, bucket11plus: 0 },
              avgLoopActions: 3,
              completionRate: 100,
              velocityMsPerAction: 5000,
            },
          ],
        ]),
      });

      const payload = buildDashboardPayload(stats);
      assert.ok(payload.insights.includes("🤖 AI is handling more complex tasks (+20% avg. depth vs last week)"));
    });
  });

  suite("anomaly detection", () => {
    test("isAnomaly and anomalyReason are false/null when fewer than 2 qualifying baseline days", () => {
      // Only 1 day with shown >= 10 → no anomaly possible
      const stats = makeStats({
        byDate: new Map([["2026-02-27", { shown: 50, accepted: 30 }]]),
      });
      const payload = buildDashboardPayload(stats);
      for (const entry of payload.timeline) {
        assert.strictEqual(entry.isAnomaly, false);
        assert.strictEqual(entry.anomalyReason, null);
      }
    });

    test("isAnomaly is false when stdDev is zero (all days have same rate)", () => {
      // All 4 days have exactly 60% acceptance rate → stdDev = 0 → no anomaly
      const payload = buildDashboardPayload(makeStats());
      for (const entry of payload.timeline) {
        assert.strictEqual(entry.isAnomaly, false);
        assert.strictEqual(entry.anomalyReason, null);
      }
    });

    test("isAnomaly is true for a day whose rate deviates by more than 2 stdDevs", () => {
      // 13 days at 60% rate, 1 day at 5% rate (extreme outlier)
      const byDate = new Map<string, { shown: number; accepted: number }>();
      for (let i = 1; i <= 13; i++) {
        byDate.set(`2026-02-${String(i).padStart(2, "0")}`, { shown: 50, accepted: 30 }); // 60%
      }
      // Outlier day: shown=50, accepted=3 → 6% — far from 60%
      byDate.set("2026-02-14", { shown: 50, accepted: 3 });

      const stats = makeStats({ byDate });
      const payload = buildDashboardPayload(stats);
      const outlier = payload.timeline.find((e) => e.date === "2026-02-14");
      assert.ok(outlier, "Outlier day should exist in timeline");
      assert.strictEqual(outlier.isAnomaly, true);
      assert.ok(outlier.anomalyReason !== null, "anomalyReason should be set for anomalous day");
      assert.ok(outlier.anomalyReason?.includes("z-score"), "anomalyReason should mention z-score");
    });

    test("days with shown < 10 are excluded from anomaly detection and are not flagged as anomalies", () => {
      // Baseline: 13 days at 60%, 1 day with shown=5 (below threshold)
      const byDate = new Map<string, { shown: number; accepted: number }>();
      for (let i = 1; i <= 13; i++) {
        byDate.set(`2026-02-${String(i).padStart(2, "0")}`, { shown: 50, accepted: 30 }); // 60%
      }
      byDate.set("2026-02-14", { shown: 5, accepted: 0 }); // below MIN_SHOWN threshold
      const stats = makeStats({ byDate });
      const payload = buildDashboardPayload(stats);
      const lowShownEntry = payload.timeline.find((e) => e.date === "2026-02-14");
      assert.ok(lowShownEntry);
      assert.strictEqual(lowShownEntry.isAnomaly, false);
      assert.strictEqual(lowShownEntry.anomalyReason, null);
    });

    test("anomalyReason contains direction word 'lower' for below-average anomaly", () => {
      const byDate = new Map<string, { shown: number; accepted: number }>();
      for (let i = 1; i <= 13; i++) {
        byDate.set(`2026-02-${String(i).padStart(2, "0")}`, { shown: 50, accepted: 30 }); // 60%
      }
      byDate.set("2026-02-14", { shown: 50, accepted: 3 }); // 6% — well below average
      const stats = makeStats({ byDate });
      const payload = buildDashboardPayload(stats);
      const outlier = payload.timeline.find((e) => e.date === "2026-02-14");
      assert.ok(outlier?.anomalyReason?.includes("lower"), `Expected 'lower' in reason: ${outlier?.anomalyReason}`);
    });

    test("anomalyReason contains direction word 'higher' for above-average anomaly", () => {
      const byDate = new Map<string, { shown: number; accepted: number }>();
      for (let i = 1; i <= 13; i++) {
        byDate.set(`2026-02-${String(i).padStart(2, "0")}`, { shown: 50, accepted: 10 }); // 20%
      }
      byDate.set("2026-02-14", { shown: 50, accepted: 48 }); // 96% — well above average
      const stats = makeStats({ byDate });
      const payload = buildDashboardPayload(stats);
      const outlier = payload.timeline.find((e) => e.date === "2026-02-14");
      assert.ok(outlier?.anomalyReason?.includes("higher"), `Expected 'higher' in reason: ${outlier?.anomalyReason}`);
    });
  });

  suite("agenticStats", () => {
    test("returns zero agenticStats when no subagent data", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.agenticStats.subagentRequests, 0);
      assert.strictEqual(payload.agenticStats.agenticRatio, 0);
      assert.strictEqual(payload.agenticStats.autonomousDurationMs, 0);
      assert.deepStrictEqual(payload.agenticStats.toolUsageStats, []);
    });

    test("includes subagentRequests, agenticRatio, autonomousDurationMs from stats", () => {
      const stats = makeStats({
        subagentRequests: 5,
        agenticRatio: 2.5,
        autonomousDurationMs: 12000,
        toolUsageStats: new Map([
          ["runSubagent", 3],
          ["editAgent", 2],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.subagentRequests, 5);
      assert.strictEqual(payload.agenticStats.agenticRatio, 2.5);
      assert.strictEqual(payload.agenticStats.autonomousDurationMs, 12000);
    });

    test("toolUsageStats is sorted by count descending", () => {
      const stats = makeStats({
        toolUsageStats: new Map([
          ["editAgent", 2],
          ["runSubagent", 5],
          ["searchSubagentTool", 1],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const sorted = payload.agenticStats.toolUsageStats;
      assert.strictEqual(sorted[0].intent, "runSubagent");
      assert.strictEqual(sorted[0].count, 5);
      assert.strictEqual(sorted[1].intent, "editAgent");
      assert.strictEqual(sorted[1].count, 2);
      assert.strictEqual(sorted[2].intent, "searchSubagentTool");
      assert.strictEqual(sorted[2].count, 1);
    });

    test("agentIntelligenceOverview is zero when no subagent data", () => {
      const payload = buildDashboardPayload(makeStats());
      const ov = payload.agenticStats.agentIntelligenceOverview;
      assert.strictEqual(ov.autonomousActionCount, 0);
      assert.strictEqual(ov.agenticLoopCount, 0);
      assert.strictEqual(ov.avgCallsPerLoop, 0);
      assert.deepStrictEqual(ov.autonomousRatioByModel, []);
    });

    test("agentIntelligenceOverview.autonomousActionCount equals subagentRequests", () => {
      const stats = makeStats({ subagentRequests: 7, subagentLoops: 2 });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.agentIntelligenceOverview.autonomousActionCount, 7);
    });

    test("agentIntelligenceOverview.avgCallsPerLoop is ratio of requests to loops", () => {
      const stats = makeStats({ subagentRequests: 6, subagentLoops: 2 });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.agentIntelligenceOverview.avgCallsPerLoop, 3);
    });

    test("agentIntelligenceOverview.avgCallsPerLoop is 0 when no loops", () => {
      const stats = makeStats({ subagentRequests: 4, subagentLoops: 0 });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.agentIntelligenceOverview.avgCallsPerLoop, 0);
    });

    test("agentIntelligenceOverview.autonomousRatioByModel excludes models with no subagent calls", () => {
      const stats = makeStats({
        byChatModel: new Map([
          ["gpt-4o", 10],
          ["claude-3", 5],
        ]),
        subagentByModel: new Map([["gpt-4o", 3]]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.strictEqual(byModel[0].model, "gpt-4o");
      assert.strictEqual(byModel[0].subagentCount, 3);
      assert.strictEqual(byModel[0].totalCount, 10);
      assert.ok(Math.abs(byModel[0].ratio - 30) < 0.01);
    });

    test("agentIntelligenceOverview.autonomousRatioByModel is sorted by ratio descending", () => {
      const stats = makeStats({
        byChatModel: new Map([
          ["gpt-4o", 10],
          ["claude-3", 4],
        ]),
        subagentByModel: new Map([
          ["gpt-4o", 2], // 20%
          ["claude-3", 2], // 50%
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel[0].model, "claude-3");
      assert.strictEqual(byModel[1].model, "gpt-4o");
    });

    test("agentIntelligenceOverview.completionRate is 0 when no loops started", () => {
      const payload = buildDashboardPayload(makeStats());
      assert.strictEqual(payload.agenticStats.agentIntelligenceOverview.completionRate, 0);
    });

    test("agentIntelligenceOverview.completionRate is ratio of completed to started loops * 100", () => {
      const stats = makeStats({ subagentLoops: 3, subagentLoopsStarted: 4, completionRate: 75 });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.agentIntelligenceOverview.completionRate, 75);
    });

    test("autonomousRatioByModel.velocitySecondsPerAction is 0 when no duration data", () => {
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 10]]),
        subagentByModel: new Map([["gpt-4o", 5]]),
        autonomousDurationByModel: new Map(),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.strictEqual(byModel[0].velocitySecondsPerAction, 0);
    });

    test("autonomousRatioByModel.velocitySecondsPerAction is durationMs / 1000 / subagentCount", () => {
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 10]]),
        subagentByModel: new Map([["gpt-4o", 4]]),
        autonomousDurationByModel: new Map([["gpt-4o", 20000]]), // 20s / 4 actions = 5s/action
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.strictEqual(byModel[0].velocitySecondsPerAction, 5);
    });

    test("autonomousRatioByModel merges entries for same normalized model name", () => {
      // Two byChatModel entries that normalize to the same key
      const stats = makeStats({
        byChatModel: new Map([
          ["gpt-4o -> deployment-a", 8],
          ["gpt-4o -> deployment-b", 2],
        ]),
        subagentByModel: new Map([
          ["gpt-4o -> deployment-a", 3],
          ["gpt-4o -> deployment-b", 1],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1, "should merge two deployments into one row");
      assert.strictEqual(byModel[0].model, "gpt-4o");
      assert.strictEqual(byModel[0].totalCount, 10);
      assert.strictEqual(byModel[0].subagentCount, 4);
      assert.ok(Math.abs(byModel[0].ratio - 40) < 0.01);
    });

    test("autonomousRatioByModel strips colon suffix when merging", () => {
      const stats = makeStats({
        byChatModel: new Map([
          ["claude-3.5-sonnet:20241022", 6],
          ["claude-3.5-sonnet:20241101", 4],
        ]),
        subagentByModel: new Map([["claude-3.5-sonnet:20241022", 2]]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.strictEqual(byModel[0].model, "claude-3.5-sonnet");
      assert.strictEqual(byModel[0].totalCount, 10);
      assert.strictEqual(byModel[0].subagentCount, 2);
    });

    test("autonomousRatioByModel includes model present only in subagentByModel (not in byChatModel)", () => {
      // Simulate Claude Opus 4.6 used only via CLI/agentic path,
      // so it appears in subagentByModel but not in byChatModel.
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 10]]),
        subagentByModel: new Map([
          ["gpt-4o", 5],
          ["claude-opus-4.6", 3],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      const models = byModel.map((e) => e.model);
      assert.ok(models.includes("claude-opus-4.6"), `Expected claude-opus-4.6 in ${models.join(", ")}`);
      const claudeEntry = byModel.find((e) => e.model === "claude-opus-4.6");
      assert.ok(claudeEntry);
      assert.strictEqual(claudeEntry.subagentCount, 3);
      assert.strictEqual(claudeEntry.totalCount, 0);
      assert.strictEqual(claudeEntry.ratio, 0);
    });

    test("planCount, executedPlanCount, planSuccessRate, userChoicesInPlan are zero when no planning data", () => {
      const payload = buildDashboardPayload(makeStats());
      const ov = payload.agenticStats.agentIntelligenceOverview;
      assert.strictEqual(ov.planCount, 0);
      assert.strictEqual(ov.executedPlanCount, 0);
      assert.strictEqual(ov.planSuccessRate, 0);
      assert.strictEqual(ov.userChoicesInPlan, 0);
    });

    test("planSuccessRate is executedPlanCount / planCount * 100", () => {
      const stats = makeStats({ planCount: 10, executedPlanCount: 8, userChoicesInPlan: 5 });
      const payload = buildDashboardPayload(stats);
      const ov = payload.agenticStats.agentIntelligenceOverview;
      assert.strictEqual(ov.planCount, 10);
      assert.strictEqual(ov.executedPlanCount, 8);
      assert.ok(Math.abs(ov.planSuccessRate - 80) < 0.001);
      assert.strictEqual(ov.userChoicesInPlan, 5);
    });

    test("planSuccessRate is 0 when planCount is 0", () => {
      const stats = makeStats({ planCount: 0, executedPlanCount: 0 });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.agentIntelligenceOverview.planSuccessRate, 0);
    });

    test("featureSignals exposes sorted browser tool breakdown", () => {
      const stats = makeStats({
        browserToolInvocations: 3,
        browserToolsByType: new Map([
          ["screenshot", 2],
          ["playwright", 1],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.featureSignals.browserTools.total, 3);
      assert.deepStrictEqual(payload.agenticStats.featureSignals.browserTools.breakdown, [
        { name: "screenshot", count: 2 },
        { name: "playwright", count: 1 },
      ]);
    });

    test("featureSignals includes plugin, memory, and debug totals", () => {
      const stats = makeStats({
        pluginOrSkillInvocations: 2,
        pluginOrSkillByName: new Map([["code-search", 2]]),
        memoryManagementEvents: [
          {
            timestamp: "2026-03-07T10:00:00Z",
            type: "compact",
            rawText: "/compact",
            sessionId: "session-1",
          },
        ],
        memoryManagementByType: new Map([["compact", 1]]),
        agentDebugEvents: 4,
        agentDebugByType: new Map([["step-execution", 4]]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.featureSignals.pluginOrSkills.total, 2);
      assert.strictEqual(payload.agenticStats.featureSignals.memoryManagement.total, 1);
      assert.strictEqual(payload.agenticStats.featureSignals.agentDebug.total, 4);
    });

    test("autonomousRatioByModel.acceptanceRate is 0 when no inline completion data for model", () => {
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 10]]),
        subagentByModel: new Map([["gpt-4o", 5]]),
        byModel: new Map(),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.strictEqual(byModel[0].acceptanceRate, 0);
      assert.strictEqual(byModel[0].totalAccepted, 0);
    });

    test("autonomousRatioByModel.acceptanceRate is accepted/shown * 100 from byModel", () => {
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 10]]),
        subagentByModel: new Map([["gpt-4o", 5]]),
        byModel: new Map([["gpt-4o", { shown: 100, accepted: 40 }]]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.ok(Math.abs(byModel[0].acceptanceRate - 40) < 0.01);
      assert.strictEqual(byModel[0].totalAccepted, 40);
    });

    test("autonomousRatioByModel.totalTimeSaved includes typing and agentic components", () => {
      // typing: 40 accepted * 40 chars / 200 cpm = 8 min
      // agentic: 120000ms / 60000 * 0.5 = 1 min
      // total: 9 min
      const stats = makeStats({
        byChatModel: new Map([["gpt-4o", 10]]),
        subagentByModel: new Map([["gpt-4o", 5]]),
        byModel: new Map([["gpt-4o", { shown: 100, accepted: 40 }]]),
        autonomousDurationByModel: new Map([["gpt-4o", 120000]]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      assert.ok(Math.abs(byModel[0].totalTimeSaved - 9) < 0.01);
    });

    test("autonomousRatioByModel.totalTimeSaved merges inline stats for same normalized model", () => {
      // Two deployment aliases of gpt-4o that normalize to the same key
      const stats = makeStats({
        byChatModel: new Map([
          ["gpt-4o -> a", 5],
          ["gpt-4o -> b", 5],
        ]),
        subagentByModel: new Map([["gpt-4o -> a", 3]]),
        byModel: new Map([
          ["gpt-4o -> a", { shown: 60, accepted: 30 }],
          ["gpt-4o -> b", { shown: 40, accepted: 10 }],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const byModel = payload.agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
      assert.strictEqual(byModel.length, 1);
      // merged: shown=100, accepted=40 → acceptanceRate=40%, totalAccepted=40
      assert.ok(Math.abs(byModel[0].acceptanceRate - 40) < 0.01);
      assert.strictEqual(byModel[0].totalAccepted, 40);
    });
  });
});

suite("buildDashboardPayload — CLI integration", () => {
  test("cli ROI is zero when cliTotalInteractions is 0", () => {
    const payload = buildDashboardPayload(makeStats({ cliTotalInteractions: 0, cliByDate: new Map() }));
    assert.strictEqual(payload.summary.totalMinutesSaved.cli, 0);
  });

  test("cli ROI equals interactions * default 30 minutes", () => {
    const payload = buildDashboardPayload(makeStats({ cliTotalInteractions: 4, cliByDate: new Map() }));
    // 4 interactions × 30 min = 120
    assert.strictEqual(payload.summary.totalMinutesSaved.cli, 120);
  });

  test("cli ROI uses custom cliRoiMinutesPerInteraction parameter", () => {
    const payload = buildDashboardPayload(
      makeStats({ cliTotalInteractions: 3, cliByDate: new Map() }),
      undefined,
      undefined,
      undefined,
      [],
      [],
      15, // custom: 15 min per interaction
    );
    assert.strictEqual(payload.summary.totalMinutesSaved.cli, 45);
  });

  test("totalMinutesSaved.total includes both editor and cli components", () => {
    // editor: 0 accepted × 40 / 200 = 0 min; cli: 2 × 30 = 60 min
    const payload = buildDashboardPayload(
      makeStats({ totalAccepted: 0, autonomousDurationMs: 0, cliTotalInteractions: 2, cliByDate: new Map() }),
    );
    assert.strictEqual(payload.summary.totalMinutesSaved.total, 60);
    assert.strictEqual(payload.summary.totalMinutesSaved.editor, 0);
    assert.strictEqual(payload.summary.totalMinutesSaved.cli, 60);
  });

  test("timeline cliShown/cliAccepted come from cliByDate prompts", () => {
    const cliByDate = new Map([["2026-02-25", { prompts: 3, outputTokens: 600 }]]);
    const payload = buildDashboardPayload(makeStats({ cliByDate, cliTotalInteractions: 3 }));
    const day = payload.timeline.find((e) => e.date === "2026-02-25");
    assert.ok(day, "Expected timeline entry for 2026-02-25");
    assert.strictEqual(day.cliShown, 3);
    assert.strictEqual(day.cliAccepted, 3);
  });

  test("timeline cliShown/cliAccepted is 0 for dates without CLI activity", () => {
    const payload = buildDashboardPayload(makeStats({ cliByDate: new Map(), cliTotalInteractions: 0 }));
    for (const entry of payload.timeline) {
      assert.strictEqual(entry.cliShown, 0);
      assert.strictEqual(entry.cliAccepted, 0);
    }
  });
});

suite("buildDashboardPayload — chatIntentBreakdown and commandUsageBreakdown", () => {
  test("chatIntentBreakdown is empty when byChatIntent is empty", () => {
    const payload = buildDashboardPayload(makeStats({ byChatIntent: new Map() }));
    assert.deepStrictEqual(payload.chatIntentBreakdown, []);
  });

  test("chatIntentBreakdown reflects byChatIntent sorted by count desc", () => {
    const payload = buildDashboardPayload(
      makeStats({
        byChatIntent: new Map([
          ["Ask", 5],
          ["Agent", 20],
          ["Plan", 3],
        ]),
      }),
    );
    assert.strictEqual(payload.chatIntentBreakdown.length, 3);
    assert.strictEqual(payload.chatIntentBreakdown[0].name, "Agent");
    assert.strictEqual(payload.chatIntentBreakdown[0].count, 20);
    assert.strictEqual(payload.chatIntentBreakdown[1].name, "Ask");
    assert.strictEqual(payload.chatIntentBreakdown[2].name, "Plan");
  });

  test("commandUsageBreakdown is empty when commandUsage is empty", () => {
    const payload = buildDashboardPayload(makeStats({ commandUsage: new Map() }));
    assert.deepStrictEqual(payload.commandUsageBreakdown, []);
  });

  test("commandUsageBreakdown reflects commandUsage sorted by count desc", () => {
    const payload = buildDashboardPayload(
      makeStats({
        commandUsage: new Map([
          ["/fix", 4],
          ["@workspace", 10],
          ["/explain", 2],
        ]),
      }),
    );
    assert.strictEqual(payload.commandUsageBreakdown.length, 3);
    assert.strictEqual(payload.commandUsageBreakdown[0].name, "@workspace");
    assert.strictEqual(payload.commandUsageBreakdown[0].count, 10);
    assert.strictEqual(payload.commandUsageBreakdown[1].name, "/fix");
    assert.strictEqual(payload.commandUsageBreakdown[2].name, "/explain");
  });

  // ── promptLengthScatterData ───────────────────────────────────────────────

  test("promptLengthScatterData is empty when promptEffectiveness is empty", () => {
    const payload = buildDashboardPayload(makeStats({ promptEffectiveness: {} }));
    assert.deepStrictEqual(payload.promptLengthScatterData, []);
  });

  test("promptLengthScatterData omits buckets with zero shown count", () => {
    const payload = buildDashboardPayload(
      makeStats({
        promptEffectiveness: {
          "0-50": { shown: 0, accepted: 0 },
        },
      }),
    );
    assert.deepStrictEqual(payload.promptLengthScatterData, []);
  });

  test("promptLengthScatterData computes acceptance rate as y", () => {
    const payload = buildDashboardPayload(
      makeStats({
        promptEffectiveness: {
          "51-100": { shown: 10, accepted: 7 },
        },
      }),
    );
    assert.strictEqual(payload.promptLengthScatterData.length, 1);
    const point = payload.promptLengthScatterData[0]!;
    assert.strictEqual(point.x, 75); // midpoint of 51-100
    assert.strictEqual(point.y, 70); // (7/10)*100 = 70.0
    assert.ok(point.r >= 4, "radius should be at least 4");
  });

  test("promptLengthScatterData uses bucket midpoints as x values", () => {
    const payload = buildDashboardPayload(
      makeStats({
        promptEffectiveness: {
          "0-50": { shown: 5, accepted: 5 },
          "101-200": { shown: 5, accepted: 5 },
          "201+": { shown: 5, accepted: 5 },
        },
      }),
    );
    const xs = payload.promptLengthScatterData.map((p) => p.x).sort((a, b) => a - b);
    assert.deepStrictEqual(xs, [25, 150, 300]);
  });

  test("promptLengthScatterData prevents zero division when shown is zero", () => {
    const payload = buildDashboardPayload(
      makeStats({
        promptEffectiveness: {
          "101-200": { shown: 0, accepted: 5 },
        },
      }),
    );
    assert.deepStrictEqual(payload.promptLengthScatterData, []);
  });

  test("promptLengthScatterData radius is proportional to shown count", () => {
    const payload = buildDashboardPayload(
      makeStats({
        promptEffectiveness: {
          "0-50": { shown: 1, accepted: 1 },
          "51-100": { shown: 100, accepted: 50 },
        },
      }),
    );
    const small = payload.promptLengthScatterData.find((p) => p.x === 25)!;
    const large = payload.promptLengthScatterData.find((p) => p.x === 75)!;
    assert.ok(large.r > small.r, "larger sample count should produce larger radius");
  });
});
