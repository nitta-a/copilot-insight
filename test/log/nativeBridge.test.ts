import * as assert from "assert";
import * as vscode from "vscode";
import {
  type NativeParseResult,
  type NativeReportInput,
  generateMarkdownReportNative,
  getNativeLoadError,
  loadNativeModule,
  parseLogChunkNative,
  parseLogFileNative,
  resetNativeModule,
  setNativeModuleLoaderForTesting,
} from "../../src/log/nativeBridge";

type ShowWarningMessage = typeof vscode.window.showWarningMessage;

const sampleParseResult: NativeParseResult = {
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
};

const sampleReportInput: NativeReportInput = {
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

suite("nativeBridge", () => {
  let originalShowWarningMessage: ShowWarningMessage;
  let originalConsoleWarn: typeof console.warn;
  let logChannelModule: typeof import("../../src/log/logChannel");
  let originalGetLogChannel: typeof import("../../src/log/logChannel").getLogChannel;
  let warningMessages: string[];
  let consoleWarnings: string[];
  let channelMessages: string[];

  setup(() => {
    resetNativeModule();
    setNativeModuleLoaderForTesting(undefined);
    warningMessages = [];
    consoleWarnings = [];
    channelMessages = [];

    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalConsoleWarn = console.warn;
    logChannelModule = require("../../src/log/logChannel") as typeof import("../../src/log/logChannel");
    originalGetLogChannel = logChannelModule.getLogChannel;

    console.warn = (...args: unknown[]) => {
      consoleWarnings.push(args.map((arg) => String(arg)).join(" "));
    };

    Object.defineProperty(vscode.window, "showWarningMessage", {
      configurable: true,
      value: ((message: string) => {
        warningMessages.push(message);
        return Promise.resolve(undefined);
      }) as ShowWarningMessage,
    });

    logChannelModule.getLogChannel = (() =>
      ({
        appendLine: (message: string) => {
          channelMessages.push(message);
        },
      }) as vscode.OutputChannel) as typeof logChannelModule.getLogChannel;
  });

  teardown(() => {
    console.warn = originalConsoleWarn;
    Object.defineProperty(vscode.window, "showWarningMessage", {
      configurable: true,
      value: originalShowWarningMessage,
    });
    logChannelModule.getLogChannel = originalGetLogChannel;
    setNativeModuleLoaderForTesting(undefined);
    resetNativeModule();
  });

  test("loadNativeModule warns only once when native addon loading fails", () => {
    setNativeModuleLoaderForTesting(() => {
      throw new Error("boom");
    });

    assert.strictEqual(loadNativeModule(), null);
    assert.strictEqual(loadNativeModule(), null);
    assert.strictEqual(parseLogChunkNative("some log text"), null);

    assert.strictEqual(warningMessages.length, 1);
    assert.strictEqual(
      warningMessages[0],
      "Rust native parser failed to load. Falling back to slow JS parser. Please run 'npm run build:native'.",
    );
    assert.strictEqual(consoleWarnings.length, 1);
    assert.match(consoleWarnings[0] ?? "", /Rust native parser failed to load.*boom/s);
    assert.strictEqual(channelMessages.length, 1);
    assert.match(channelMessages[0] ?? "", /\[native-parser\]/);
    assert.match(channelMessages[0] ?? "", /boom/);
    assert.match(getNativeLoadError() ?? "", /boom/);
  });

  test("parse helpers use the loaded native module", () => {
    setNativeModuleLoaderForTesting(() => ({
      parseLogChunk: () => sampleParseResult,
      parseLogFileNative: () => sampleParseResult,
      generateMarkdownReportNative: () => "# report",
    }));

    assert.ok(loadNativeModule());
    assert.deepStrictEqual(parseLogChunkNative("some log text"), sampleParseResult);
    assert.deepStrictEqual(parseLogFileNative("/tmp/example.log"), sampleParseResult);
    assert.strictEqual(generateMarkdownReportNative(sampleReportInput, "January 2026"), "# report");
    assert.strictEqual(getNativeLoadError(), undefined);
    assert.deepStrictEqual(warningMessages, []);
    assert.deepStrictEqual(channelMessages, []);
  });

  test("NativeParseResult interface matches expected shape", () => {
    assert.strictEqual(sampleParseResult.totalShown, 10);
    assert.strictEqual(sampleParseResult.totalAccepted, 3);
    assert.strictEqual(sampleParseResult.totalChat, 5);
    assert.strictEqual(sampleParseResult.subagentRequests, 2);
    assert.strictEqual(sampleParseResult.planCount, 1);
    assert.strictEqual(sampleParseResult.byModelShown["gpt-4o"], 7);
    assert.strictEqual(sampleParseResult.byModelAccepted["gpt-4o"], 3);
    assert.strictEqual(sampleParseResult.byDate["2024-06-15"]?.shown, 5);
    assert.strictEqual(sampleParseResult.byDate["2024-06-15"]?.accepted, 2);
    assert.strictEqual(sampleParseResult.byHour["14"], 3);
    assert.deepStrictEqual(sampleParseResult.latencies, [120, 290, 450]);
    assert.strictEqual(sampleParseResult.byContextSource["vscodePrompt"], 4);
    assert.strictEqual(sampleParseResult.contextRichness.promptCount, 4);
    assert.strictEqual(sampleParseResult.contextRichness.totalPromptChars, 800);
    assert.strictEqual(sampleParseResult.autonomousDurationMs, 5000);
    assert.strictEqual(sampleParseResult.subagentLoops, 2);
    assert.strictEqual(sampleParseResult.executedPlanCount, 1);
    assert.strictEqual(sampleParseResult.browserToolsByType["screenshot"], 3);
    assert.strictEqual(sampleParseResult.errorsByType["HTTP 429"], 1);
  });

  test("resetNativeModule clears cached failure state", () => {
    setNativeModuleLoaderForTesting(() => {
      throw new Error("boom");
    });

    assert.strictEqual(loadNativeModule(), null);
    assert.match(getNativeLoadError() ?? "", /boom/);

    resetNativeModule();

    assert.strictEqual(getNativeLoadError(), undefined);
    assert.strictEqual(loadNativeModule(), null);
    assert.strictEqual(warningMessages.length, 2);
  });
});
