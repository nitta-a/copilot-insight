import * as assert from "assert";
import { generateMarkdownReport } from "../../src/export/reportGenerator";
import type {
  ModelPerformanceResult,
  VelocityAnalysisResult,
} from "../../src/metrics/metricsEngine";
import type { CopilotUsageStats } from "../../src/types";

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
    assert.ok(md.includes("| Suggestions Shown (legacy logs) | 100 |"));
    assert.ok(md.includes("| Suggestions Accepted (legacy logs) | 70 |"));
    assert.ok(md.includes("| Acceptance Rate | 70.0% |"));
    assert.ok(md.includes("| Chat Requests | 15 |"));
  });

  test("marks the acceptance rate unavailable when no suggestions were shown", () => {
    const md = generateMarkdownReport({ period: "test", stats: makeStats({ totalShown: 0, acceptanceRate: 0 }) });
    assert.ok(md.includes("| Acceptance Rate | Unavailable |"));
  });

  test("omits legacy completion counts without recorded completions", () => {
    const md = generateMarkdownReport({ period: "test", stats: makeStats({ totalShown: 0, totalAccepted: 0 }) });
    assert.ok(!md.includes("Suggestions Shown"));
    assert.ok(!md.includes("Suggestions Accepted"));
  });

  test("includes Copilot CLI token and AI credit usage", () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      reasoningTokens: 5,
      totalNanoAiu: 1_500_000_000,
    };
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        cliUsage: usage,
        cliUsageByModel: new Map([["gpt-6-luna", usage]]),
      }),
    });

    assert.ok(md.includes("## Copilot CLI Token and AI Credit Usage"));
    assert.ok(md.includes("| AI Credits | 1.500000 |"));
    assert.ok(md.includes("| gpt-6-luna | 100 | 20 | 1.500000 |"));
  });

  test("includes escaped conversation totals and unavailable credit values", () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalNanoAiu: null,
    };
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        cliUsage: usage,
        cliThreads: [
          {
            sessionId: "thread-a",
            title: "Fix | <example>",
            startedAt: null,
            lastActivityAt: null,
            prompts: 1,
            usage,
            turns: [],
          },
        ],
      }),
    });
    assert.ok(md.includes("Copilot CLI Thread Totals"));
    assert.ok(md.includes("| 1 | 120 | Unavailable |"));
    assert.ok(!md.includes("Fix | <example>"));
  });

  test("does not estimate developer time saved", () => {
    const md = generateMarkdownReport({ period: "test", stats: makeStats({ autonomousDurationMs: 120000 }) });
    assert.ok(!md.includes("Time Saved"));
    assert.ok(!md.includes("Productivity Metrics"));
  });

  test("includes project name when provided", () => {
    const md = generateMarkdownReport({
      period: "test",
      projectName: "my-project",
      stats: makeStats(),
    });
    assert.ok(md.includes("**Project:** my-project"));
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


  test("labels legacy agent counts without inferred success or ROI", () => {
    const md = generateMarkdownReport({ period: "test", stats: makeStats({ subagentRequests: 2, autonomousDurationMs: 120000 }) });
    assert.ok(md.includes("## Legacy Agent Log Activity"));
    assert.ok(md.includes("Recorded subagent requests"));
    assert.ok(md.includes("Recorded elapsed duration"));
    assert.ok(!md.includes("Agentic ROI"));
    assert.ok(!md.includes("Planning Success Rate"));
    assert.ok(!md.includes("Thinking Depth"));
  });

  test("includes 1.110 feature signal section when present", () => {
    const md = generateMarkdownReport({
      period: "test",
      stats: makeStats({
        browserToolInvocations: 2,
        browserToolsByType: new Map([["screenshot", 2]]),
        agentDebugEvents: 1,
        agentDebugByType: new Map([["step-execution", 1]]),
      }),
    });
    assert.ok(md.includes("## Observed Events"));
    assert.ok(md.includes("### Browser Tools"));
    assert.ok(md.includes("**screenshot**: 2"));
    assert.ok(md.includes("### Agent Debug"));
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
