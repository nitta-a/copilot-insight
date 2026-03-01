import * as assert from "assert";
import type { CopilotUsageStats } from "../../types";
import type { TrueAcceptanceResult, VelocityAnalysisResult, ModelPerformanceResult } from "../../metrics/metricsEngine";
import { generateMarkdownReport } from "../../export/reportGenerator";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 100,
    totalAccepted: 70,
    totalRejected: 30,
    totalChat: 15,
    acceptanceRate: 70.0,
    avgLatencyMs: 250,
    byLanguage: new Map([
      ["typescript", { shown: 60, accepted: 45 }],
      ["python", { shown: 40, accepted: 25 }],
    ]),
    byDate: new Map([["2026-02-28", { shown: 100, accepted: 70 }]]),
    byModel: new Map([["gpt-4", { shown: 80, accepted: 60 }]]),
    byChatModel: new Map([["gpt-4o", 15]]),
    byHour: new Map([["10", 30]]),
    byChatIntent: new Map([["Agent", 10]]),
    logFilesFound: 5,
    chatByDate: new Map([["2026-02-28", 15]]),
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
    bySession: new Map(),
    byContextSource: new Map(),
    ...overrides,
  };
}

suite("reportGenerator", () => {
  test("generates valid Markdown with header", () => {
    const md = generateMarkdownReport({
      period: "2026-02-01 — 2026-02-28",
      stats: makeStats(),
    });
    assert.ok(md.includes("# Copilot Insight — Usage Report"));
    assert.ok(md.includes("**Period:** 2026-02-01 — 2026-02-28"));
  });

  test("includes executive summary with correct values", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
    });
    assert.ok(md.includes("## Executive Summary"));
    assert.ok(md.includes("| Suggestions Shown | 100 |"));
    assert.ok(md.includes("| Suggestions Accepted | 70 |"));
    assert.ok(md.includes("| Acceptance Rate | 70.0% |"));
    assert.ok(md.includes("| Chat Requests | 15 |"));
  });

  test("includes project name when provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      projectName: "my-project",
      stats: makeStats(),
    });
    assert.ok(md.includes("**Project:** my-project"));
  });

  test("includes language breakdown", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
    });
    assert.ok(md.includes("## Language Breakdown"));
    assert.ok(md.includes("| typescript |"));
    assert.ok(md.includes("| python |"));
  });

  test("includes acceptance analysis when trueAcceptance provided", () => {
    const trueAcceptance: TrueAcceptanceResult = {
      rawAccepted: 70,
      trueAccepted: 60,
      rawRate: 70,
      trueRate: 60,
      revertedCount: 10,
    };
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
      trueAcceptance,
    });
    assert.ok(md.includes("## Acceptance Analysis"));
    assert.ok(md.includes("| True Accepted (retained) | 60 |"));
    assert.ok(md.includes("| Reverted Completions | 10 |"));
  });

  test("includes model performance when provided", () => {
    const modelPerformance: ModelPerformanceResult = {
      crossTab: [
        {
          modelName: "gpt-4o",
          languageId: "typescript",
          totalAccepted: 50,
          totalCharsAccepted: 2000,
          avgLatencyMs: 200,
        },
      ],
      bestModelByLanguage: new Map([["typescript", "gpt-4o"]]),
    };
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
      modelPerformance,
    });
    assert.ok(md.includes("## Model Performance"));
    assert.ok(md.includes("| gpt-4o |"));
    assert.ok(md.includes("### Best Model per Language"));
    assert.ok(md.includes("**typescript**: gpt-4o"));
  });

  test("includes velocity analysis when provided", () => {
    const velocity: VelocityAnalysisResult = {
      timeSeries: [],
      averageKpm: 120.5,
      disruptionCount: 3,
    };
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
      velocity,
    });
    assert.ok(md.includes("## Velocity & Flow Analysis"));
    assert.ok(md.includes("120.5 keystrokes/min"));
    assert.ok(md.includes("3 windows"));
  });

  test("includes ROI estimation", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
    });
    assert.ok(md.includes("## ROI Estimation"));
    assert.ok(md.includes("Estimated Characters Generated"));
    assert.ok(md.includes("Estimated Time Saved"));
  });

  test("omits acceptance analysis when not provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
    });
    assert.ok(!md.includes("## Acceptance Analysis"));
  });

  test("omits model performance when not provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
    });
    assert.ok(!md.includes("## Model Performance"));
  });
});
