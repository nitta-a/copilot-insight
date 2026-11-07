import * as assert from "assert";
import type { SessionSignalEvent } from "../../src/events/eventSchema";
import type { CliUsageStat, CopilotUsageStats, SessionSummary } from "../../src/types";
import {
  buildCliSessionDetail,
  buildDashboardPayload,
  buildPromptInsightsPayload,
  buildSessionsPayload,
} from "../../src/ui/dashboardPayload";
import { addUsage, parseEventsJsonl } from "../../src/log/cliLogReader";

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
    subagentRequests: 0,
    autonomousDurationMs: 0,
    toolUsageStats: new Map(),
    subagentByModel: new Map(),
    autonomousDurationByModel: new Map(),
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
    cliToolExecutions: new Map(),
    cliAgentTypes: new Map(),
    commandUsage: new Map(),
    promptEffectiveness: {},
    chatSessionStates: new Map(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    tokensByModel: new Map(),
    finishReasonCounts: new Map(),
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

    test("sessionSummaries are forwarded into the payload", () => {
      const summaries: SessionSummary[] = [
        {
          sessionId: "s1",
          title: "Investigate session explorer",
          date: "2026-03-07",
          totalActions: 12,
          autonomousDuration: 12_000,
        },
      ];
      const payload = buildSessionsPayload(makeStats(), summaries);
      assert.deepStrictEqual(payload.sessionSummaries, summaries);
    });

    test("fallback session summaries are shown with date as title when no explicit sessions are available", () => {
      const payload = buildSessionsPayload(makeStats());
      assert.strictEqual(payload.sessionSummaries.length, 1);
      assert.strictEqual(payload.sessionSummaries[0]?.sessionId, "s1");
      assert.ok(payload.sessionSummaries[0]?.title, "fallback session should have a non-empty title");
    });

    test("untitled explicit session summaries fall back to date instead of disappearing", () => {
      const summaries: SessionSummary[] = [
        {
          sessionId: "s1",
          title: null,
          date: "2026-03-07",
          totalActions: 12,
          autonomousDuration: 12_000,
        },
      ];

      const payload = buildSessionsPayload(makeStats(), summaries);
      assert.strictEqual(payload.sessionSummaries.length, 1);
      assert.strictEqual(payload.sessionSummaries[0]?.sessionId, "s1");
      assert.strictEqual(payload.sessionSummaries[0]?.title, "2026-03-07");
    });

    test("blank explicit session titles fall back to sessionId when date is empty", () => {
      const summaries: SessionSummary[] = [
        {
          sessionId: "session-without-date",
          title: "   ",
          date: "",
          totalActions: 3,
          autonomousDuration: 0,
        },
      ];

      const payload = buildSessionsPayload(makeStats(), summaries);
      assert.strictEqual(payload.sessionSummaries.length, 1);
      assert.strictEqual(payload.sessionSummaries[0]?.title, "session-without-date");
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
      assert.ok(entry.rate !== null && Math.abs(entry.rate - expectedRate) < 0.001);
    });

    test("leaves missing rates empty while preserving an observed zero", () => {
      const payload = buildDashboardPayload(
        makeStats({
          byDate: new Map([
            ["2026-11-01", { shown: 0, accepted: 0 }],
            ["2026-11-02", { shown: 10, accepted: 0 }],
          ]),
          chatByDate: new Map(),
        }),
      );
      assert.deepStrictEqual(
        payload.timeline.map((entry) => entry.rate),
        [null, 0],
      );
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
        assert.strictEqual(entry.cliPrompts, 0);
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

    test("availableRange is empty when no dated activity exists", () => {
      const stats = makeStats({ byDate: new Map(), chatByDate: new Map(), cliByDate: new Map() });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.availableRange.minDate, "");
      assert.strictEqual(payload.availableRange.maxDate, "");
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
      assert.strictEqual(payload.agenticStats.autonomousDurationMs, 0);
      assert.deepStrictEqual(payload.agenticStats.toolUsageStats, []);
      assert.deepStrictEqual(payload.agenticStats.cliToolExecutions, []);
      assert.deepStrictEqual(payload.agenticStats.cliAgentTypes, []);
    });

    test("includes subagentRequests and autonomousDurationMs from stats", () => {
      const stats = makeStats({
        subagentRequests: 5,
        autonomousDurationMs: 12000,
        toolUsageStats: new Map([
          ["runSubagent", 3],
          ["editAgent", 2],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.subagentRequests, 5);
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

    test("cliToolExecutions is sorted by total count descending", () => {
      const stats = makeStats({
        cliToolExecutions: new Map([
          ["grep_search", { total: 2, success: 1, fail: 1 }],
          ["read_file", { total: 5, success: 5, fail: 0 }],
          ["run_in_terminal", { total: 1, success: 1, fail: 0 }],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const sorted = payload.agenticStats.cliToolExecutions;
      assert.strictEqual(sorted[0].name, "read_file");
      assert.strictEqual(sorted[0].total, 5);
      assert.strictEqual(sorted[0].successRate, 100);
      assert.strictEqual(sorted[1].name, "grep_search");
      assert.strictEqual(sorted[2].name, "run_in_terminal");
    });

    test("cliToolExecutions computes successRate from success and total", () => {
      const stats = makeStats({
        cliToolExecutions: new Map([["read_file", { total: 4, success: 3, fail: 1 }]]),
      });
      const payload = buildDashboardPayload(stats);
      assert.strictEqual(payload.agenticStats.cliToolExecutions[0]?.successRate, 75);
    });


    test("cliAgentTypes is sorted by count descending and computes share", () => {
      const stats = makeStats({
        cliAgentTypes: new Map([
          ["general-purpose", 2],
          ["planner", 5],
          ["researcher", 3],
        ]),
      });
      const payload = buildDashboardPayload(stats);
      const sorted = payload.agenticStats.cliAgentTypes;
      assert.strictEqual(sorted[0].name, "planner");
      assert.strictEqual(sorted[0].count, 5);
      assert.strictEqual(sorted[0].share, 50);
      assert.strictEqual(sorted[1].name, "researcher");
      assert.strictEqual(sorted[2].name, "general-purpose");
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




  });
});

suite("buildDashboardPayload — CLI integration", () => {




  test("timeline includes CLI-only and chat-only days without inventing acceptance rates", () => {
    const cliByDate = new Map([["2026-03-01", { prompts: 3, outputTokens: 600 }]]);
    const chatByDate = new Map([["2026-03-02", 2]]);
    const payload = buildDashboardPayload(makeStats({ byDate: new Map(), chatByDate, cliByDate }));
    assert.deepStrictEqual(
      payload.timeline.map((entry) => [entry.date, entry.cliPrompts, entry.chatCount, entry.rate]),
      [
        ["2026-03-01", 3, 0, null],
        ["2026-03-02", 0, 2, null],
      ],
    );
    assert.deepStrictEqual(payload.availableRange, { minDate: "2026-03-01", maxDate: "2026-03-02" });
  });

  test("timeline CLI prompts come from cliByDate", () => {
    const cliByDate = new Map([["2026-02-25", { prompts: 3, outputTokens: 600 }]]);
    const payload = buildDashboardPayload(makeStats({ cliByDate, cliTotalInteractions: 3 }));
    const day = payload.timeline.find((e) => e.date === "2026-02-25");
    assert.ok(day, "Expected timeline entry for 2026-02-25");
    assert.strictEqual(day.cliPrompts, 3);
  });

  test("timeline CLI prompts are 0 for dates without CLI activity", () => {
    const payload = buildDashboardPayload(makeStats({ cliByDate: new Map(), cliTotalInteractions: 0 }));
    for (const entry of payload.timeline) {
      assert.strictEqual(entry.cliPrompts, 0);
    }
  });

  test("includes CLI tokens and AI credits from local usage records", () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      reasoningTokens: 50,
      totalNanoAiu: 3_118_259_500,
    };
    const payload = buildDashboardPayload(
      makeStats({
        cliUsage: usage,
        cliUsageByModel: new Map([["gpt-6-luna", usage]]),
        cliByDate: new Map([
          ["2026-02-25", { prompts: 3, outputTokens: 200, usage }],
          [
            "2026-02-26",
            {
              prompts: 1,
              outputTokens: 50,
              usage: { ...usage, inputTokens: 100, outputTokens: 50, totalNanoAiu: 500_000_000 },
            },
          ],
        ]),
      }),
    );

    assert.strictEqual(payload.summary.cliUsageStats?.totalTokens, 1_200);
    assert.strictEqual(payload.summary.cliUsageStats?.totalAiCredits, 3.1182595);
    assert.strictEqual(payload.summary.cliUsageStats?.topModels[0]?.model, "gpt-6-luna");
    assert.strictEqual(payload.summary.cliUsageStats?.dailyUsage[0]?.date, "2026-02-25");
  });

  test("omits CLI usage cards when local usage records are unavailable", () => {
    const payload = buildDashboardPayload(makeStats());
    assert.strictEqual(payload.summary.cliUsageStats, null);
  });

  test("keeps more than seven daily points and exposes undated accounting differences", () => {
    const daily = Array.from({ length: 12 }, (_, index) => {
      const date = `2026-11-${String(index + 1).padStart(2, "0")}`;
      return [
        date,
        {
          prompts: 1,
          outputTokens: 20,
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 60,
            cacheWriteTokens: 30,
            reasoningTokens: 5,
            totalNanoAiu: 1_000_000_000,
          },
        },
      ] as const;
    });
    const payload = buildDashboardPayload(
      makeStats({
        cliByDate: new Map(daily),
        cliUsage: {
          inputTokens: 1_300,
          outputTokens: 260,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalNanoAiu: 13_500_000_000,
        },
      }),
    );
    assert.strictEqual(payload.summary.cliUsageStats?.dailyUsage.length, 12);
    assert.deepStrictEqual(payload.summary.cliUsageStats?.dailyUsage[0], {
      date: "2026-11-01",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      aiCredits: 1,
    });
    assert.strictEqual(payload.summary.cliUsageStats?.unattributedTokens, 120);
    assert.strictEqual(payload.summary.cliUsageStats?.unattributedAiCredits, 1.5);
  });

  test("preserves missing daily and total credit values instead of converting them to zero", () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalNanoAiu: null,
    };
    const payload = buildDashboardPayload(
      makeStats({ cliUsage: usage, cliByDate: new Map([["2026-11-01", { prompts: 1, outputTokens: 20, usage }]]) }),
    );
    assert.strictEqual(payload.summary.cliUsageStats?.totalAiCredits, null);
    assert.strictEqual(payload.summary.cliUsageStats?.dailyUsage[0].aiCredits, null);
    assert.strictEqual(payload.summary.cliUsageStats?.unattributedAiCredits, null);
  });
});

suite("CLI conversation consumption in Sessions", () => {
  test("aggregates timestamped project records across sessions and detects old snapshots", () => {
    const makeThread = (id: string, date: string, credits: number | null) =>
      parseEventsJsonl(
        [
          { type: "session.start", data: { sessionId: id, context: { cwd: "/work/a" } } },
          {
            type: "session.usage_record",
            timestamp: `${date}T12:00:00Z`,
            data: {
              usage: {
                inputTokens: 10,
                cacheReadTokens: 4,
                copilotUsage: { totalNanoAiu: credits },
              },
            },
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n"),
      ).thread!;
    const threads = [
      makeThread("a", "2026-11-01", 1_000_000_000),
      makeThread("b", "2026-11-01", null),
      makeThread("c", "2026-11-02", 1_000_000_000),
    ];
    const usage = threads.reduce((sum, thread) => addUsage(sum, thread.usage), undefined as CliUsageStat | undefined)!;
    const payload = buildDashboardPayload(makeStats({ cliThreads: threads, cliUsage: usage })).summary.cliUsageStats!;
    assert.equal(payload.projectDailyUsageAvailable, true);
    assert.equal(payload.projects?.[0].dailyUsage[0].usage.inputTokens, 20);
    assert.equal(payload.projects?.[0].dailyUsage[0].usage.cacheReadTokens, 8);
    assert.equal(payload.projects?.[0].dailyUsage[0].usage.totalNanoAiu, null);
    assert.equal(payload.projects?.[0].dailyUsage[1].usage.totalNanoAiu, 1_000_000_000);
    const old = buildDashboardPayload(
      makeStats({ cliThreads: [{ ...threads[0], usageByDate: undefined }], cliUsage: usage }),
    ).summary.cliUsageStats!;
    assert.equal(old.projectDailyUsageAvailable, false);
    assert.ok(old.projects);
  });
  test("aggregates reconciled sessions by full project path and preserves unknown credits", () => {
    const session = (id: string, context: object, credits: number | undefined, checkpoint = false) => {
      const events: object[] = [
        { type: "session.start", data: { sessionId: id, context } },
        {
          type: "session.usage_record",
          data: {
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 30,
              cacheWriteTokens: 10,
              copilotUsage: credits === undefined ? {} : { totalNanoAiu: credits },
            },
          },
        },
      ];
      if (checkpoint) {
        events.push({
          type: "session.shutdown",
          data: {
            accountingSnapshot: {
              totalNanoAiu: 2_000_000_000,
              modelMetrics: {
                "Copilot CLI": {
                  usage: { inputTokens: 150, outputTokens: 25, cacheReadTokens: 40, cacheWriteTokens: 15 },
                  totalNanoAiu: 2_000_000_000,
                },
              },
            },
          },
        });
      }
      return parseEventsJsonl(events.map((event) => JSON.stringify(event)).join("\n"));
    };
    const results = [
      session("a", { gitRoot: "/one/project", cwd: "/other" }, 1_000_000_000, true),
      session("b", { cwd: "/one/project" }, undefined),
      session("c", { cwd: "/two/project" }, 1_000_000_000),
      session("d", {}, 1_000_000_000),
    ];
    const threads = results.map((result) => result.thread!);
    const total = results.reduce((sum, result) => addUsage(sum, result.usage), undefined as CliUsageStat | undefined)!;
    const usage = buildDashboardPayload(makeStats({ cliThreads: threads, cliUsage: total })).summary.cliUsageStats!;
    assert.deepStrictEqual(
      usage.projects?.map((project) => [
        project.path,
        project.name,
        project.inputTokens,
        project.outputTokens,
        project.cacheReadTokens,
        project.cacheWriteTokens,
        project.aiCredits,
      ]),
      [
        ["/one/project", "project", 250, 45, 70, 25, null],
        ["/two/project", "project", 100, 20, 30, 10, 1],
        [null, "Unknown", 100, 20, 30, 10, 1],
      ],
    );
    for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
      assert.strictEqual(
        usage.projects?.reduce((sum, project) => sum + project[field], 0),
        total[field],
      );
    }
    assert.strictEqual(usage.totalAiCredits, null);
    assert.strictEqual(
      buildDashboardPayload(makeStats({ cliUsage: total, cliThreads: [{ ...threads[0], projectPath: undefined }] }))
        .summary.cliUsageStats?.projects,
      null,
    );
  });
  test("connects parsed CLI threads and prompt totals to the Sessions list and detail", () => {
    const result = parseEventsJsonl(
      [
        { type: "session.start", data: { sessionId: "s1", startTime: "2026-11-01T23:00:00Z" } },
        { type: "user.message", timestamp: "2026-11-01T23:00:00Z", data: { content: "Implement charts" } },
        { type: "user.message", data: { content: "Delegate", source: "agent-123" } },
        {
          type: "session.usage_record",
          timestamp: "2026-11-02T01:00:00Z",
          data: {
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              model: "model-a",
              duration: 1200,
              copilotUsage: { totalNanoAiu: 1_250_000_000 },
            },
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );
    assert.ok(result.thread);
    result.thread.agentHostChats = [{ title: "Review", origin: "tool", children: [] }];
    const stats = makeStats({ cliThreads: [result.thread], cliUsage: result.usage, cliByDate: result.byDate });
    const sessions = buildSessionsPayload(stats);
    assert.strictEqual(sessions.sessionSummaries.length, 2);
    assert.ok(
      sessions.sessionSummaries.some((entry) => entry.sessionId === "s1"),
      "Editor session remains separate",
    );
    assert.ok(sessions.sessionSummaries.some((entry) => entry.sessionId === "cli:s1"));
    const detail = buildCliSessionDetail(stats, "cli:s1");
    assert.strictEqual(detail?.threads[0].title, "Implement charts");
    assert.strictEqual(detail?.threads[0].usageSource, "cli");
    assert.strictEqual(detail?.threads[0].usage?.totalNanoAiu, 1_250_000_000);
    assert.strictEqual(detail?.threads[0].stepCount, 1);
    assert.deepStrictEqual(detail?.threads[0].agentHostChats, result.thread.agentHostChats);
    assert.strictEqual(detail?.stepsByThread["cli:s1"][1].actor, "ai");
    assert.strictEqual(detail?.stepsByThread["cli:s1"][1].usage?.outputTokens, 20);
    assert.strictEqual(buildDashboardPayload(stats).summary.cliUsageStats?.modelCalls?.[0].durationMs, 1200);
    assert.strictEqual(buildCliSessionDetail(stats, "s1"), null);
    assert.strictEqual(buildCliSessionDetail(stats, "cli:missing"), null);
  });

  test("keeps snapshot-only threads inspectable even without prompt steps", () => {
    const result = parseEventsJsonl(
      JSON.stringify({
        type: "session.shutdown",
        data: {
          totalNanoAiu: 500_000_000,
          modelMetrics: { "model-a": { usage: { inputTokens: 100 }, totalNanoAiu: 500_000_000 } },
        },
      }),
      "CLI",
      "snapshot-thread",
    );
    assert.ok(result.thread);
    const stats = makeStats({ cliThreads: [result.thread] });
    const detail = buildCliSessionDetail(stats, "cli:snapshot-thread");
    assert.strictEqual(detail?.threads[0].stepCount, 0);
    assert.strictEqual(detail?.threads[0].usage?.totalNanoAiu, 500_000_000);
    assert.deepStrictEqual(detail?.stepsByThread["cli:snapshot-thread"], []);
  });
});

suite("buildDashboardPayload — chatIntentBreakdown and commandUsageBreakdown", () => {
  test("chatIntentBreakdown is empty when byChatIntent is empty", () => {
    const payload = buildPromptInsightsPayload(makeStats({ byChatIntent: new Map() }));
    assert.deepStrictEqual(payload.chatIntentBreakdown, []);
  });

  test("chatIntentBreakdown reflects byChatIntent sorted by count desc", () => {
    const payload = buildPromptInsightsPayload(
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
    const payload = buildPromptInsightsPayload(makeStats({ commandUsage: new Map() }));
    assert.deepStrictEqual(payload.commandUsageBreakdown, []);
  });

  test("commandUsageBreakdown reflects commandUsage sorted by count desc", () => {
    const payload = buildPromptInsightsPayload(
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

  test("finishReasonBreakdown is empty when finishReasonCounts is empty", () => {
    const payload = buildPromptInsightsPayload(makeStats({ finishReasonCounts: new Map() }));
    assert.deepStrictEqual(payload.finishReasonBreakdown, []);
  });

  test("finishReasonBreakdown reflects finishReasonCounts sorted by count desc", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        finishReasonCounts: new Map([
          ["stop", 12],
          ["length", 5],
          ["content_filter", 1],
        ]),
      }),
    );
    assert.strictEqual(payload.finishReasonBreakdown.length, 3);
    assert.strictEqual(payload.finishReasonBreakdown[0].name, "stop");
    assert.strictEqual(payload.finishReasonBreakdown[0].count, 12);
    assert.strictEqual(payload.finishReasonBreakdown[1].name, "length");
    assert.strictEqual(payload.finishReasonBreakdown[2].name, "content_filter");
  });

  // ── promptLengthScatterData ───────────────────────────────────────────────

  test("promptLengthScatterData is empty when promptEffectiveness is empty", () => {
    const payload = buildPromptInsightsPayload(makeStats({ promptEffectiveness: {} }));
    assert.deepStrictEqual(payload.promptLengthScatterData, []);
  });

  test("promptLengthScatterData omits buckets with zero shown count", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        promptEffectiveness: {
          "0-50": { shown: 0, accepted: 0 },
        },
      }),
    );
    assert.deepStrictEqual(payload.promptLengthScatterData, []);
  });

  test("promptLengthScatterData computes acceptance rate as y", () => {
    const payload = buildPromptInsightsPayload(
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
    const payload = buildPromptInsightsPayload(
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
    const payload = buildPromptInsightsPayload(
      makeStats({
        promptEffectiveness: {
          "101-200": { shown: 0, accepted: 5 },
        },
      }),
    );
    assert.deepStrictEqual(payload.promptLengthScatterData, []);
  });

  test("promptLengthScatterData radius is proportional to shown count", () => {
    const payload = buildPromptInsightsPayload(
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

suite("buildPromptInsightsPayload — topKeywords", () => {
  function makeTitleRecord(id: string, title: string, firstRequestText: string | null = null) {
    return {
      chatSessionId: id,
      workspaceId: "ws1",
      title,
      createdAt: "2026-01-01",
      lastMessageAt: null,
      firstRequestText,
    };
  }

  function makeSessionRecord(id: string, title: string | null, firstRequestText: string | null, messagTexts: string[]) {
    const requests = messagTexts.map((text, i) => ({
      requestId: `r${i}`,
      timestamp: 0,
      agentId: "copilot",
      customAgentName: null,
      modelId: "gpt-4o",
      messageText: text,
      timings: { firstProgress: null, totalElapsed: null },
      toolCalls: [],
      availableSkills: [],
      loadedSkills: [],
    }));
    return {
      chatSessionId: id,
      workspaceId: "ws1",
      title,
      createdAt: "2026-01-01",
      lastMessageAt: null,
      firstRequestText,
      requests,
      source: "jsonl" as const,
      provider: "copilot" as const,
    };
  }

  test("turnStats buckets saved chat sessions by their recorded request count", () => {
    const sessions = [0, 1, 2, 3, 4, 5, 6].map((count) =>
      makeSessionRecord(`session-${count}`, null, null, Array(count).fill("request")),
    );
    const payload = buildPromptInsightsPayload(makeStats({ chatSessions: sessions }));
    assert.deepStrictEqual(
      payload.turnStats.map((bucket) => bucket.sessionCount),
      [1, 2, 2, 1],
    );
  });

  test("topKeywords is empty when chatSessionTitles and chatSessions are both undefined", () => {
    const payload = buildPromptInsightsPayload(makeStats());
    assert.deepStrictEqual(payload.topKeywords, []);
  });

  test("topKeywords is empty when chatSessionTitles and chatSessions are empty arrays", () => {
    const payload = buildPromptInsightsPayload(makeStats({ chatSessionTitles: [], chatSessions: [] }));
    assert.deepStrictEqual(payload.topKeywords, []);
  });

  test("topKeywords extracted from chatSessionTitles[].title", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        chatSessionTitles: [makeTitleRecord("s1", "typescript refactor"), makeTitleRecord("s2", "typescript types")],
      }),
    );
    const words = payload.topKeywords.map((k) => k.word);
    assert.ok(words.includes("typescript"), "expected 'typescript' in topKeywords");
    const ts = payload.topKeywords.find((k) => k.word === "typescript");
    assert.strictEqual(ts?.count, 2, "typescript should appear twice");
  });

  test("topKeywords extracted from chatSessionTitles[].firstRequestText", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        chatSessionTitles: [makeTitleRecord("s1", "session", "explain typescript generics")],
      }),
    );
    const words = payload.topKeywords.map((k) => k.word);
    assert.ok(words.includes("typescript"), "expected 'typescript' from firstRequestText");
    assert.ok(words.includes("generics"), "expected 'generics' from firstRequestText");
  });

  test("topKeywords extracted from chatSessions[].requests[].messageText", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        chatSessions: [makeSessionRecord("s1", null, null, ["write unit tests", "write unit tests coverage"])],
      }),
    );
    const words = payload.topKeywords.map((k) => k.word);
    assert.ok(words.includes("write"), "expected 'write' in topKeywords");
    assert.ok(words.includes("unit"), "expected 'unit' in topKeywords");
    assert.ok(words.includes("tests"), "expected 'tests' in topKeywords");
    const write = payload.topKeywords.find((k) => k.word === "write");
    assert.strictEqual(write?.count, 2, "'write' should appear in both requests");
  });

  test("stop-words are filtered out from topKeywords", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        chatSessionTitles: [makeTitleRecord("s1", "the best and greatest typescript fix")],
      }),
    );
    const words = payload.topKeywords.map((k) => k.word);
    assert.ok(!words.includes("the"), "'the' should be filtered as a stop-word");
    assert.ok(!words.includes("and"), "'and' should be filtered as a stop-word");
    assert.ok(words.includes("typescript"), "content word 'typescript' should be present");
  });

  test("topKeywords is sorted by frequency descending", () => {
    const payload = buildPromptInsightsPayload(
      makeStats({
        chatSessionTitles: [
          makeTitleRecord("s1", "typescript refactor"),
          makeTitleRecord("s2", "typescript types"),
          makeTitleRecord("s3", "refactor methods"),
        ],
      }),
    );
    // typescript: 2, refactor: 2, types: 1, methods: 1 — at least two entries, sorted desc
    assert.ok(payload.topKeywords.length >= 2);
    assert.ok(
      payload.topKeywords[0].count >= payload.topKeywords[1].count,
      "first entry should have count >= second entry",
    );
  });
});
