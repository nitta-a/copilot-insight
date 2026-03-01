import * as assert from "assert";
import { buildDashboardPayload } from "../../src/ui/dashboardPayload";
import type { CopilotUsageStats } from "../../src/types";
import type {
  TrueAcceptanceResult,
  VelocityAnalysisResult,
  ModelPerformanceResult,
} from "../../src/metrics/metricsEngine";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 200,
    totalAccepted: 120,
    totalRejected: 80,
    totalChat: 20,
    acceptanceRate: 60.0,
    avgLatencyMs: 300,
    byLanguage: new Map([
      ["typescript", { shown: 120, accepted: 80 }],
      ["python", { shown: 80, accepted: 40 }],
    ]),
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
    ...overrides,
  };
}

suite("buildDashboardPayload", () => {
  suite("summary", () => {
    test("sets totalShown, totalAccepted, acceptanceRate from stats", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      assert.strictEqual(payload.summary.totalShown, 200);
      assert.strictEqual(payload.summary.totalAccepted, 120);
      assert.strictEqual(payload.summary.acceptanceRate, 60.0);
    });

    test("trueAcceptanceRate is null when no trueAcceptance passed", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
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
      const payload = buildDashboardPayload(makeStats(), 14, ta);
      assert.strictEqual(payload.summary.trueAcceptanceRate, 50);
    });

    test("estimatedMinutesSaved is acceptedCount * 40 chars / 200 CPM", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      // 120 * 40 / 200 = 24
      assert.strictEqual(payload.summary.estimatedMinutesSaved, 24);
    });

    test("bestModel is null when no modelPerformance passed", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      assert.strictEqual(payload.summary.bestModel, null);
    });

    test("bestModel is the most-frequent best model across languages", () => {
      const mp: ModelPerformanceResult = {
        crossTab: [],
        bestModelByLanguage: new Map([
          ["typescript", "gpt-4o"],
          ["python", "gpt-4o"],
          ["go", "claude-3.5"],
        ]),
      };
      const payload = buildDashboardPayload(makeStats(), 14, undefined, undefined, mp);
      assert.strictEqual(payload.summary.bestModel, "gpt-4o");
    });
  });

  suite("timeline", () => {
    test("timeline length is capped by days parameter", () => {
      const payload = buildDashboardPayload(makeStats(), 3);
      assert.strictEqual(payload.timeline.length, 3);
    });

    test("timeline is sorted by date ascending", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      const dates = payload.timeline.map((e) => e.date);
      const sorted = [...dates].sort();
      assert.deepStrictEqual(dates, sorted);
    });

    test("timeline entry rate is calculated correctly", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      const entry = payload.timeline[0];
      assert.ok(entry);
      const expectedRate = (entry.accepted / entry.shown) * 100;
      assert.ok(Math.abs(entry.rate - expectedRate) < 0.001);
    });

    test("timeline trueAccepted is null (not available per day)", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      for (const entry of payload.timeline) {
        assert.strictEqual(entry.trueAccepted, null);
      }
    });

    test("days field in payload matches parameter", () => {
      const payload = buildDashboardPayload(makeStats(), 7);
      assert.strictEqual(payload.days, 7);
    });
  });

  suite("velocityPoints", () => {
    test("velocityPoints is empty when no velocity passed", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
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
      const payload = buildDashboardPayload(makeStats(), 14, undefined, velocity);
      assert.strictEqual(payload.velocityPoints.length, 2);
      assert.strictEqual(payload.velocityPoints[0].kpm, 120);
      assert.strictEqual(payload.velocityPoints[0].flowDisrupted, false);
      assert.strictEqual(payload.velocityPoints[1].flowDisrupted, true);
    });
  });

  suite("languageBreakdown", () => {
    test("language breakdown is sorted by shown descending", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      const langs = payload.languageBreakdown.map((e) => e.language);
      assert.strictEqual(langs[0], "typescript");
      assert.strictEqual(langs[1], "python");
    });

    test("language entry rate is calculated correctly", () => {
      const payload = buildDashboardPayload(makeStats(), 14);
      const ts = payload.languageBreakdown.find((e) => e.language === "typescript");
      assert.ok(ts);
      // 80 / 120 * 100 ≈ 66.67
      assert.ok(Math.abs(ts.rate - (80 / 120) * 100) < 0.001);
    });

    test("language breakdown capped at 15 entries", () => {
      const byLanguage = new Map<string, { shown: number; accepted: number }>();
      for (let i = 0; i < 20; i++) {
        byLanguage.set(`lang${i}`, { shown: 20 - i, accepted: 10 });
      }
      const payload = buildDashboardPayload(makeStats({ byLanguage }), 14);
      assert.ok(payload.languageBreakdown.length <= 15);
    });
  });
});
