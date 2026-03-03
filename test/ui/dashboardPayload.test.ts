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

  suite("anomaly detection", () => {
    test("isAnomaly and anomalyReason are false/null when fewer than 2 qualifying baseline days", () => {
      // Only 1 day with shown >= 10 → no anomaly possible
      const stats = makeStats({
        byDate: new Map([["2026-02-27", { shown: 50, accepted: 30 }]]),
      });
      const payload = buildDashboardPayload(stats, 14);
      for (const entry of payload.timeline) {
        assert.strictEqual(entry.isAnomaly, false);
        assert.strictEqual(entry.anomalyReason, null);
      }
    });

    test("isAnomaly is false when stdDev is zero (all days have same rate)", () => {
      // All 4 days have exactly 60% acceptance rate → stdDev = 0 → no anomaly
      const payload = buildDashboardPayload(makeStats(), 14);
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
      const payload = buildDashboardPayload(stats, 14);
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
      const payload = buildDashboardPayload(stats, 14);
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
      const payload = buildDashboardPayload(stats, 14);
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
      const payload = buildDashboardPayload(stats, 14);
      const outlier = payload.timeline.find((e) => e.date === "2026-02-14");
      assert.ok(outlier?.anomalyReason?.includes("higher"), `Expected 'higher' in reason: ${outlier?.anomalyReason}`);
    });
  });
});
