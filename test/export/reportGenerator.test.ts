import * as assert from "assert";
import type { CopilotUsageStats } from "../../src/types";
import type {
  TrueAcceptanceResult,
  VelocityAnalysisResult,
  ModelPerformanceResult,
} from "../../src/metrics/metricsEngine";
import { generateMarkdownReport } from "../../src/export/reportGenerator";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 100,
    totalAccepted: 70,
    totalRejected: 30,
    totalChat: 15,
    acceptanceRate: 70.0,
    avgLatencyMs: 250,
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
    ...overrides,
  };
}

suite("reportGenerator", () => {
  test("generates valid Markdown with header", () => {
    const md = generateMarkdownReport({
      period: "2026-02-01 — 2026-02-28",
      stats: makeStats(),
    });
    assert.ok(md.includes("# GitHub Copilot Contribution Report"));
    assert.ok(md.includes("**Period:** 2026-02-01 — 2026-02-28"));
  });

  test("report title includes date range from stats.byDate", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        byDate: new Map([
          ["2026-02-24", { shown: 50, accepted: 30 }],
          ["2026-03-04", { shown: 50, accepted: 30 }],
        ]),
      }),
    });
    assert.ok(md.includes("(2026/02/24 - 2026/03/04)"), `Expected date range in title, got: ${md.split("\n")[0]}`);
  });

  test("report title shows single date when only one day in stats", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({ byDate: new Map([["2026-02-28", { shown: 100, accepted: 70 }]]) }),
    });
    assert.ok(md.includes("(2026/02/28)"), `Expected single date in title, got: ${md.split("\n")[0]}`);
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
    assert.ok(md.includes("## 📊 Productivity Metrics"));
    assert.ok(md.includes("Total Developer Time Saved"));
    assert.ok(md.includes("Coding Assistance"));
  });

  test("includes agentic autonomy breakdown when agenticMinutesSaved provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
      typingMinutesSaved: 10,
      agenticMinutesSaved: 20,
    });
    assert.ok(md.includes("Agentic Autonomy"));
    // total = 30 minutes = 0.5 hours → toFixed(1) = "0.5"
    assert.ok(md.includes("0.5 hours"));
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

  test("includes agentic ROI section when subagent activity present", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        subagentRequests: 50,
        agenticRatio: 25.0,
        autonomousDurationMs: 12540000, // ~209m 17s
        subagentLoops: 10,
        subagentLoopsStarted: 12,
        completionRate: 83.3,
        subagentByModel: new Map([["gpt-4o", 30]]),
        autonomousDurationByModel: new Map([["gpt-4o", 9000000]]),
        agenticDepthByModel: new Map(),
      }),
    });
    assert.ok(md.includes("## Agentic ROI Summary"));
    assert.ok(md.includes("Autonomous Duration"));
    assert.ok(md.includes("Episode Completion Rate"));
    assert.ok(md.includes("AI Autonomous Time"));
  });

  test("omits agentic ROI section when no subagent activity", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({ subagentRequests: 0 }),
    });
    assert.ok(!md.includes("## Agentic ROI Summary"));
  });

  test("includes intelligence overview section when subagent activity present", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        subagentRequests: 50,
        subagentLoops: 10,
        completionRate: 83.3,
        subagentByModel: new Map(),
        autonomousDurationByModel: new Map(),
        agenticDepthByModel: new Map(),
      }),
    });
    assert.ok(md.includes("## Agent Intelligence Details"));
    assert.ok(md.includes("Avg Calls / Loop"));
  });

  test("includes model performance comparison section when subagentByModel has entries", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        subagentRequests: 30,
        agenticRatio: 20.0,
        autonomousDurationMs: 5000000,
        subagentLoops: 5,
        subagentLoopsStarted: 6,
        completionRate: 83.3,
        subagentByModel: new Map([
          ["gpt-4o", 20],
          ["gpt-4-turbo", 10],
        ]),
        autonomousDurationByModel: new Map([["gpt-4o", 3000000]]),
        agenticDepthByModel: new Map(),
      }),
    });
    assert.ok(md.includes("## Model Efficiency"));
    assert.ok(md.includes("gpt-4o"));
  });

  test("includes qualitative insights section when insights provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
      insights: ["📈 Acceptance rate improved by 5%", "📉 Chat usage decreased"],
    });
    assert.ok(md.includes("## 💡 Qualitative Insights"));
    assert.ok(md.includes("📈 Acceptance rate improved by 5%"));
    assert.ok(md.includes("📉 Chat usage decreased"));
  });

  test("omits qualitative insights section when not provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats(),
    });
    assert.ok(!md.includes("## 💡 Qualitative Insights"));
  });
});
