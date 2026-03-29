import * as assert from "assert";
import {
  type NativeParseResult,
  type NativeReportInput,
  generateMarkdownReportNative,
  loadNativeModule,
  parseLogChunkNative,
  parseLogFileNative,
  resetNativeModule,
} from "../../src/log/nativeBridge";

suite("nativeBridge", () => {
  setup(() => {
    // Reset the cached native module before each test so we get a fresh state.
    resetNativeModule();
  });

  test("loadNativeModule returns null when native addon is not built", () => {
    const result = loadNativeModule();
    // The native addon is not compiled during the normal test run so we
    // expect the bridge to gracefully return null.
    assert.strictEqual(result, null);
  });

  test("parseLogChunkNative returns null when native addon is not built", () => {
    const result = parseLogChunkNative("some log text");
    assert.strictEqual(result, null);
  });

  test("parseLogFileNative returns null when native addon is not built", () => {
    const result = parseLogFileNative("/nonexistent/path.log");
    assert.strictEqual(result, null);
  });

  test("generateMarkdownReportNative returns null when native addon is not built", () => {
    const input: NativeReportInput = {
      totalShown: 10,
      totalAccepted: 7,
      totalChat: 5,
      totalErrors: 0,
      logFilesFound: 1,
      avgLatencyMs: 200,
      subagentRequests: 0,
      autonomousDurationMs: 0,
      agenticRatio: 0,
      subagentLoops: 0,
      subagentLoopsStarted: 0,
      completionRate: 0,
      planCount: 0,
      executedPlanCount: 0,
      userChoicesInPlan: 0,
      browserToolsByType: {},
      pluginOrSkillByName: {},
      memoryManagementCount: 0,
      memoryManagementByType: {},
      agentDebugEvents: 0,
      agentDebugByType: {},
      subagentByModel: {},
      autonomousDurationByModel: {},
      byChatModel: {},
      minDate: "2026-01-01",
      maxDate: "2026-01-31",
      typingMinutesSaved: 0,
      agenticMinutesSaved: 0,
      projectName: "",
      errorsByType: {},
    };
    const result = generateMarkdownReportNative(input, "January 2026");
    assert.strictEqual(result, null);
  });

  test("NativeParseResult interface matches expected shape", () => {
    // Verify the interface can be used as a type guard at compile time.
    const sample: NativeParseResult = {
      totalShown: 10,
      totalAccepted: 3,
      totalChat: 5,
      subagentRequests: 2,
      planCount: 1,
      byModelShown: { "gpt-4o": 7, "claude-3.5-sonnet": 3 },
      byModelAccepted: { "gpt-4o": 3 },
      byDate: { "2024-06-15": { shown: 5, accepted: 2 } },
      byHour: { "14": 3, "09": 7 },
      latencies: [120, 290, 450],
      byContextSource: { vscodePrompt: 4, activeDocument: 1 },
      contextRichness: {
        totalPromptChars: 800,
        promptCount: 4,
      },
      autonomousDurationMs: 5000,
      subagentLoops: 2,
      executedPlanCount: 1,
      browserToolsByType: { screenshot: 3 },
      errorsByType: { "HTTP 429": 1 },
      totalPromptTokens: 1500,
      totalCompletionTokens: 200,
      tokensByModel: { "gpt-4o": [1200, 150] },
      linesParsed: 42,
      jsonLines: 10,
      byChatModel: { "gpt-4o": 3 },
      subagentByModel: { "gpt-4o": 1 },
      autonomousDurationByModel: { "gpt-4o": 500 },
      chatByDate: { "2024-06-15": 3 },
      finishReasonCounts: { stop: 2, length: 1 },
      subagentLoopsStarted: 1,
      totalRejected: 2,
      loopsCompletedByModel: { "gpt-4o": 2 },
      totalLoopActionsByModel: { "gpt-4o": 8 },
    };
    assert.strictEqual(sample.totalShown, 10);
    assert.strictEqual(sample.totalAccepted, 3);
    assert.strictEqual(sample.totalChat, 5);
    assert.strictEqual(sample.subagentRequests, 2);
    assert.strictEqual(sample.planCount, 1);
    assert.strictEqual(sample.byModelShown["gpt-4o"], 7);
    assert.strictEqual(sample.byModelAccepted["gpt-4o"], 3);
    assert.strictEqual(sample.byDate["2024-06-15"]?.shown, 5);
    assert.strictEqual(sample.byDate["2024-06-15"]?.accepted, 2);
    assert.strictEqual(sample.byHour["14"], 3);
    assert.deepStrictEqual(sample.latencies, [120, 290, 450]);
    assert.strictEqual(sample.byContextSource["vscodePrompt"], 4);
    assert.strictEqual(sample.contextRichness.promptCount, 4);
    assert.strictEqual(sample.contextRichness.totalPromptChars, 800);
    assert.strictEqual(sample.autonomousDurationMs, 5000);
    assert.strictEqual(sample.subagentLoops, 2);
    assert.strictEqual(sample.executedPlanCount, 1);
    assert.strictEqual(sample.browserToolsByType["screenshot"], 3);
    assert.strictEqual(sample.errorsByType["HTTP 429"], 1);
    assert.strictEqual(sample.linesParsed, 42);
    assert.strictEqual(sample.jsonLines, 10);
    assert.strictEqual(sample.byChatModel["gpt-4o"], 3);
    assert.strictEqual(sample.subagentByModel["gpt-4o"], 1);
    assert.strictEqual(sample.autonomousDurationByModel["gpt-4o"], 500);
    assert.strictEqual(sample.chatByDate["2024-06-15"], 3);
    assert.strictEqual(sample.finishReasonCounts["stop"], 2);
    assert.strictEqual(sample.subagentLoopsStarted, 1);
    assert.strictEqual(sample.totalRejected, 2);
    assert.strictEqual(sample.loopsCompletedByModel["gpt-4o"], 2);
    assert.strictEqual(sample.totalLoopActionsByModel["gpt-4o"], 8);
  });

  test("resetNativeModule allows reloading the module cache", () => {
    // Load once to populate the cache.
    loadNativeModule();
    // Reset and verify a fresh load attempt works without throwing.
    resetNativeModule();
    const result = loadNativeModule();
    assert.strictEqual(result, null);
  });
});
