import * as assert from "assert";
import {
  detectCommandUsage,
  extractThreadTitleFromPayload,
  incrementStatCount,
  mergeCountByNormalizedModel,
  mergeStatsByNormalizedModel,
  normalizeContextSource,
  normalizeModelName,
  parseLogContent,
  parseTextLogLine,
  processJsonEntry,
  tryParseJsonLogLine,
} from "../../src/log/logContentParser";
import { resetNativeModule, setNativeModuleLoaderForTesting } from "../../src/log/nativeBridge";
import type { ParsingContext } from "../../src/types";

function makeEmptyStats(): ParsingContext {
  return {
    totalShown: 0,
    totalAccepted: 0,
    totalRejected: 0,
    totalChat: 0,
    acceptanceRate: 0,
    avgLatencyMs: 0,
    byDate: new Map(),
    byModel: new Map(),
    byChatModel: new Map(),
    byHour: new Map(),
    byChatIntent: new Map(),
    logFilesFound: 0,
    chatByDate: new Map(),
    chatByHour: new Map(),
    totalErrors: 0,
    errorsByType: new Map(),
    latencies: [],
    chatLatencies: [],
    latencyP50: 0,
    latencyP95: 0,
    latencyP99: 0,
    chatAvgLatencyMs: 0,
    chatLatencyP50: 0,
    chatLatencyP95: 0,
    bySession: new Map(),
    byContextSource: new Map(),
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
    latencySum: 0,
    latencyCount: 0,
    chatLatencySum: 0,
    chatLatencyCount: 0,
    currentSessionId: "",
    activeSubagentLoop: null,
    activeSubagentLoopModel: null,
    activeSubagentLoopActionCount: 0,
    loopsStartedByModel: new Map(),
    loopsCompletedByModel: new Map(),
    totalLoopActionsByModel: new Map(),
    loopDistributionByModel: new Map(),
    loopsStartedByDate: new Map(),
    loopsCompletedByDate: new Map(),
    totalLoopActionsByDate: new Map(),
    loopDistributionByDate: new Map(),
    autonomousDurationByDate: new Map(),
    byContextEffectiveness: new Map(),
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
    activePlanPending: false,
    chatSessionStates: new Map(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    tokensByModel: new Map(),
    finishReasonCounts: new Map(),
  };
}

suite("logContentParser", () => {
  teardown(() => {
    setNativeModuleLoaderForTesting(undefined);
    resetNativeModule();
  });

  suite("incrementStatCount", () => {
    test("increments shown count for new key", () => {
      const map = new Map();
      incrementStatCount(map, "typescript", "shown");
      assert.deepStrictEqual(map.get("typescript"), { shown: 1, accepted: 0 });
    });

    test("increments accepted count for new key", () => {
      const map = new Map();
      incrementStatCount(map, "python", "accepted");
      assert.deepStrictEqual(map.get("python"), { shown: 0, accepted: 1 });
    });

    test("accumulates counts for existing key", () => {
      const map = new Map();
      incrementStatCount(map, "typescript", "shown");
      incrementStatCount(map, "typescript", "shown");
      incrementStatCount(map, "typescript", "accepted");
      assert.deepStrictEqual(map.get("typescript"), { shown: 2, accepted: 1 });
    });

    test("does nothing for empty key", () => {
      const map = new Map();
      incrementStatCount(map, "", "shown");
      assert.strictEqual(map.size, 0);
    });
  });

  suite("processJsonEntry", () => {
    test("records browser tool signals from JSON event fields", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "browser_screenshot",
          toolName: "playwright",
          timestamp: "2026-03-07T10:00:00Z",
        },
        stats,
      );
      assert.strictEqual(stats.browserToolInvocations, 1);
      assert.strictEqual(stats.browserToolsByType.get("playwright"), 1);
    });

    test("increments totalShown for shown event", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "suggestion_shown",
          language: "typescript",
          timestamp: "2024-01-15T10:00:00Z",
        },
        stats,
      );
      assert.strictEqual(stats.totalShown, 1);
      assert.strictEqual(stats.totalAccepted, 0);
      assert.strictEqual(stats.totalRejected, 0);
    });

    test("increments totalShown for displayed event", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "completion_displayed" }, stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("increments totalShown for triggered event", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "completion_triggered" }, stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("increments totalAccepted for accepted event", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "suggestion_accepted", language: "python" }, stats);
      assert.strictEqual(stats.totalAccepted, 1);
      assert.strictEqual(stats.totalShown, 0);
    });

    test("increments totalRejected for rejected event", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "suggestion_rejected" }, stats);
      assert.strictEqual(stats.totalRejected, 1);
    });

    test("increments totalRejected for dismissed event", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "completion_dismissed" }, stats);
      assert.strictEqual(stats.totalRejected, 1);
    });

    test("uses eventName when event is absent", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ eventName: "suggestion_accepted" }, stats);
      assert.strictEqual(stats.totalAccepted, 1);
    });

    test("uses languageId when language is absent", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "shown",
          languageId: "rust",
          timestamp: "2024-03-01T00:00:00Z",
        },
        stats,
      );
      assert.strictEqual(stats.totalShown, 1);
    });

    test("extracts date from timestamp", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", timestamp: "2024-03-15T12:34:56Z" }, stats);
      assert.deepStrictEqual(stats.byDate.get("2024-03-15"), {
        shown: 1,
        accepted: 0,
      });
    });

    test("ignores unknown events", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "unknown_event" }, stats);
      assert.strictEqual(stats.totalShown, 0);
      assert.strictEqual(stats.totalAccepted, 0);
      assert.strictEqual(stats.totalRejected, 0);
    });

    test("records shown count in byContextEffectiveness for shown event with contextItems", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "suggestion_shown",
          contextItems: [{ type: "openTab" }, { type: "workspace" }],
        },
        stats,
      );
      assert.deepStrictEqual(stats.byContextEffectiveness.get("Open Tabs"), { shown: 1, accepted: 0 });
      assert.deepStrictEqual(stats.byContextEffectiveness.get("Workspace"), { shown: 1, accepted: 0 });
    });

    test("records accepted count in byContextEffectiveness for accepted event with contextItems", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "suggestion_accepted",
          contextItems: [{ type: "openTab" }],
        },
        stats,
      );
      assert.deepStrictEqual(stats.byContextEffectiveness.get("Open Tabs"), { shown: 0, accepted: 1 });
    });

    test("records shown in byContextEffectiveness for shown event with directType contextType", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "suggestion_shown", contextType: "currentFile" }, stats);
      assert.deepStrictEqual(stats.byContextEffectiveness.get("Current File"), { shown: 1, accepted: 0 });
    });

    test("does not update byContextEffectiveness for rejected events", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "suggestion_rejected",
          contextItems: [{ type: "openTab" }],
        },
        stats,
      );
      assert.strictEqual(stats.byContextEffectiveness.size, 0);
    });

    test("accumulates promptTokens and completionTokens from JSON entry", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "chat/request", modelId: "gpt-4o", promptTokens: 500, completionTokens: 80 }, stats);
      assert.strictEqual(stats.totalPromptTokens, 500);
      assert.strictEqual(stats.totalCompletionTokens, 80);
      assert.deepStrictEqual(stats.tokensByModel.get("gpt-4o"), { promptTokens: 500, completionTokens: 80 });
    });

    test("accumulates prompt_tokens (snake_case) alias", () => {
      const stats = makeEmptyStats();
      // biome-ignore lint/style/useNamingConvention: testing snake_case field aliases from log data
      processJsonEntry({ event: "chat/request", modelId: "gpt-4o", prompt_tokens: 300, completion_tokens: 60 }, stats);
      assert.strictEqual(stats.totalPromptTokens, 300);
      assert.strictEqual(stats.totalCompletionTokens, 60);
    });

    test("uses totalTokens as completion fallback when no split present", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "chat/request", modelId: "gpt-4o", totalTokens: 400 }, stats);
      assert.strictEqual(stats.totalPromptTokens, 0);
      assert.strictEqual(stats.totalCompletionTokens, 400);
    });

    test("accumulates tokens across multiple entries", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "chat/request", modelId: "gpt-4o", promptTokens: 500, completionTokens: 80 }, stats);
      processJsonEntry(
        { event: "chat/request", modelId: "claude-3.5-sonnet", promptTokens: 300, completionTokens: 60 },
        stats,
      );
      assert.strictEqual(stats.totalPromptTokens, 800);
      assert.strictEqual(stats.totalCompletionTokens, 140);
      assert.deepStrictEqual(stats.tokensByModel.get("gpt-4o"), { promptTokens: 500, completionTokens: 80 });
      assert.deepStrictEqual(stats.tokensByModel.get("claude-3.5-sonnet"), { promptTokens: 300, completionTokens: 60 });
    });

    test("ignores entries with zero or missing token counts", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "suggestion_shown" }, stats);
      assert.strictEqual(stats.totalPromptTokens, 0);
      assert.strictEqual(stats.totalCompletionTokens, 0);
      assert.strictEqual(stats.tokensByModel.size, 0);
    });
  });

  test("parseLogContent merges native session signals and chat session states", async () => {
    const stats = makeEmptyStats();
    stats.currentSessionId = "vscode-session-fallback";
    stats.chatSessionStates.set("chat-session-1", {
      sessionId: "chat-session-1",
      turnCount: 1,
      isAccepted: false,
    });

    setNativeModuleLoaderForTesting(() => ({
      parseLogChunk: () => ({
        totalShown: 0,
        totalAccepted: 0,
        totalChat: 0,
        subagentRequests: 0,
        planCount: 0,
        byModelShown: {},
        byModelAccepted: {},
        byDate: {},
        byHour: {},
        latencies: [],
        byContextSource: {},
        contextRichness: { totalPromptChars: 0, promptCount: 0 },
        autonomousDurationMs: 0,
        subagentLoops: 0,
        executedPlanCount: 0,
        browserToolsByType: {},
        errorsByType: {},
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        tokensByModel: {},
        sessionSignals: [
          {
            timestamp: "2026-03-26T12:00:00Z",
            signalType: "plan-proposal",
            actor: "ai",
            phase: "planning",
            intent: "agent/plan",
            rawText: "agent/plan",
            modelName: "gpt-4o",
            latencyMs: 0,
            success: true,
            sessionId: "",
          },
        ],
        chatSessionStates: {
          "chat-session-1": {
            sessionId: "chat-session-1",
            turnCount: 2,
            isAccepted: true,
          },
          "chat-session-2": {
            sessionId: "chat-session-2",
            turnCount: 1,
            isAccepted: false,
          },
        },
      }),
      parseLogFileNative: () => {
        throw new Error("not used");
      },
      generateMarkdownReportNative: () => "",
    }));

    await parseLogContent("ignored because native parser is mocked", stats);

    assert.strictEqual(stats.sessionSignals.length, 1);
    assert.strictEqual(stats.sessionSignals[0]?.sessionId, "vscode-session-fallback");
    assert.strictEqual(stats.sessionSignals[0]?.signalType, "plan-proposal");

    assert.deepStrictEqual(stats.chatSessionStates.get("chat-session-1"), {
      sessionId: "chat-session-1",
      turnCount: 3,
      isAccepted: true,
    });
    assert.deepStrictEqual(stats.chatSessionStates.get("chat-session-2"), {
      sessionId: "chat-session-2",
      turnCount: 1,
      isAccepted: false,
    });
  });

  suite("tryParseJsonLogLine", () => {
    test("returns false for lines without JSON", () => {
      const stats = makeEmptyStats();
      const result = tryParseJsonLogLine("plain text log line", stats);
      assert.strictEqual(result, false);
    });

    test("returns true and updates stats for valid JSON line", () => {
      const stats = makeEmptyStats();
      const line = `2024-01-15 INFO ${JSON.stringify({ event: "suggestion_shown", language: "typescript" })}`;
      const result = tryParseJsonLogLine(line, stats);
      assert.strictEqual(result, true);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("returns false for invalid JSON", () => {
      const stats = makeEmptyStats();
      const result = tryParseJsonLogLine("{ invalid json }", stats);
      assert.strictEqual(result, false);
    });

    test("returns false for line with only { but no }", () => {
      const stats = makeEmptyStats();
      const result = tryParseJsonLogLine("line with { but no closing", stats);
      assert.strictEqual(result, false);
    });

    test("records thread title signal when JSON contains title-like keys", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "session-title";
      const line = `2026-03-08 12:00:00.000 INFO ${JSON.stringify({ topic: "Investigate flaky auth refresh", event: "chat_meta" })}`;
      const result = tryParseJsonLogLine(line, stats);
      assert.strictEqual(result, true);
      assert.strictEqual(stats.sessionSignals.length, 1);
      assert.strictEqual(stats.sessionSignals[0]?.signalType, "thread-title");
      assert.strictEqual(stats.sessionSignals[0]?.rawText, "Investigate flaky auth refresh");
    });
  });

  suite("extractThreadTitleFromPayload", () => {
    test("extracts title from nested payload", () => {
      assert.strictEqual(
        extractThreadTitleFromPayload({ metadata: { summary: "Refactor session boundary heuristics" } }),
        "Refactor session boundary heuristics",
      );
    });

    test("ignores url-like or hash-like values", () => {
      assert.strictEqual(extractThreadTitleFromPayload({ title: "https://example.com/path" }), null);
      assert.strictEqual(extractThreadTitleFromPayload({ title: "550e8400-e29b-41d4-a716-446655440000" }), null);
    });
  });

  test("real log style title intent is classified as planning metadata", () => {
    const stats = makeEmptyStats();
    stats.currentSessionId = "session-title-intent";
    parseTextLogLine(
      "2026-03-07 12:11:33.232 [info] ccreq:d670e6af.copilotmd | success | gpt-4o-mini-2024-07-18 | 736ms | [title]",
      stats,
    );
    assert.strictEqual(stats.sessionSignals.length, 1);
    assert.strictEqual(stats.sessionSignals[0]?.intent, "title");
    assert.strictEqual(stats.sessionSignals[0]?.actor, "system");
    assert.strictEqual(stats.sessionSignals[0]?.phase, "planning");
  });

  suite("parseTextLogLine", () => {
    test("records plugin or skill signals from text lines", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("[PluginTool] invokeTool plugin: code-search", stats);
      assert.strictEqual(stats.pluginOrSkillInvocations, 1);
      assert.strictEqual(stats.pluginOrSkillByName.get("code-search"), 1);
    });

    test("records memory management signals from text lines", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2026-03-07 10:15:30 /compact summarize_context context_limit reached", stats);
      assert.strictEqual(stats.memoryManagementEvents.length, 1);
      assert.strictEqual(stats.memoryManagementByType.get("compact"), 1);
      assert.strictEqual(stats.memoryManagementEvents[0]?.timestamp, "2026-03-07T10:15:30");
      assert.strictEqual(stats.memoryManagementEvents[0]?.type, "compact");
    });

    test("records context-limit and truncation events with timestamps", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2026-03-07 10:20:00 context_limit_reached before truncating_history", stats);
      assert.strictEqual(stats.memoryManagementEvents.length, 1);
      assert.strictEqual(stats.memoryManagementEvents[0]?.timestamp, "2026-03-07T10:20:00");
      assert.strictEqual(stats.memoryManagementEvents[0]?.type, "context-limit-reached");
      assert.strictEqual(stats.memoryManagementByType.get("context-limit-reached"), 1);
    });

    test("records agent debug signals from text lines", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("[AgentDebug] step-execution breakpoint paused", stats);
      assert.strictEqual(stats.agentDebugEvents, 1);
      assert.strictEqual(stats.agentDebugByType.get("step-execution"), 1);
    });

    test("records finish reason 'stop' from [streamChoices] line", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2026-03-20T12:00:00Z [streamChoices] solution 0 returned. finish reason: [stop]", stats);
      assert.strictEqual(stats.finishReasonCounts.get("stop"), 1);
    });

    test("records finish reason 'length' from [streamChoices] line", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2026-03-20T12:00:00Z [streamChoices] solution 1 returned. finish reason: [length]", stats);
      assert.strictEqual(stats.finishReasonCounts.get("length"), 1);
    });

    test("accumulates multiple finish reason counts", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("[streamChoices] solution 0 returned. finish reason: [stop]", stats);
      parseTextLogLine("[streamChoices] solution 0 returned. finish reason: [stop]", stats);
      parseTextLogLine("[streamChoices] solution 1 returned. finish reason: [length]", stats);
      assert.strictEqual(stats.finishReasonCounts.get("stop"), 2);
      assert.strictEqual(stats.finishReasonCounts.get("length"), 1);
    });

    test("does not modify finishReasonCounts for unrelated lines", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("some unrelated log line", stats);
      assert.strictEqual(stats.finishReasonCounts.size, 0);
    });
  });

  suite("parseLogContent", () => {
    test("skips empty lines", async () => {
      const stats = makeEmptyStats();
      await parseLogContent("\n\n\n", stats);
      assert.strictEqual(stats.totalShown, 0);
    });

    test("parses multiple lines", async () => {
      const stats = makeEmptyStats();
      const content = [
        `${JSON.stringify({ event: "suggestion_shown", language: "typescript", timestamp: "2024-01-15T10:00:00Z" })}`,
        `${JSON.stringify({ event: "suggestion_accepted", language: "typescript", timestamp: "2024-01-15T10:01:00Z" })}`,
        "[AsyncCompletionManager] AbortError: operation cancelled",
      ].join("\n");
      await parseLogContent(content, stats);
      assert.strictEqual(stats.totalShown, 1);
      assert.strictEqual(stats.totalAccepted, 1);
      assert.strictEqual(stats.totalRejected, 1);
    });

    test("parses JSON lines preferentially over text parsing", async () => {
      const stats = makeEmptyStats();
      // A line that contains JSON and also text that could be matched as text
      const line = `suggestion shown ${JSON.stringify({ event: "suggestion_accepted" })}`;
      await parseLogContent(line, stats);
      // Should be parsed as JSON (accepted), not text (shown)
      assert.strictEqual(stats.totalAccepted, 1);
      assert.strictEqual(stats.totalShown, 0);
    });

    test("increments totalRejected via JSON rejected event", async () => {
      const stats = makeEmptyStats();
      await parseLogContent(JSON.stringify({ event: "suggestion_rejected", timestamp: "2024-01-15T10:00:00Z" }), stats);
      assert.strictEqual(stats.totalRejected, 1);
      assert.strictEqual(stats.totalShown, 0);
      assert.strictEqual(stats.totalAccepted, 0);
    });
  });

  suite("parseTextLogLine – ccreq chat model tracking", () => {
    test("ccreq with vscodePrompt tracks model in byChatModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.totalChat, 1);
      assert.strictEqual(stats.byChatModel.get("gpt-4o"), 1);
      assert.strictEqual(stats.byModel.size, 0);
    });

    test("ccreq with panel/editAgent tracks model in byChatModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:def456 | success | claude-3.5-sonnet | 1200ms | [panel/editAgent]", stats);
      assert.strictEqual(stats.totalChat, 1);
      assert.strictEqual(stats.byChatModel.get("claude-3.5-sonnet"), 1);
    });

    test("ccreq with panel/unknown tracks model in byChatModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:ghi789 | success | gemini-2.0-flash | 950ms | [panel/unknown]", stats);
      assert.strictEqual(stats.totalChat, 1);
      assert.strictEqual(stats.byChatModel.get("gemini-2.0-flash"), 1);
    });

    test("ccreq with copilotLanguageModelWrapper (old format) tracks model in byChatModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:jkl012 | success | gpt-4o | 700ms | [copilotLanguageModelWrapper]", stats);
      assert.strictEqual(stats.totalChat, 1);
      assert.strictEqual(stats.byChatModel.get("gpt-4o"), 1);
    });

    test("ccreq with XtabProvider tracks model in byModel (inline shown), not byChatModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:mno345 | success | gpt-4o | 120ms | [XtabProvider]", stats);
      assert.strictEqual(stats.totalChat, 0);
      assert.strictEqual(stats.totalShown, 1);
      assert.strictEqual(stats.totalAccepted, 0);
      assert.deepStrictEqual(stats.byModel.get("gpt-4o"), { shown: 1, accepted: 0 });
      assert.strictEqual(stats.byChatModel.size, 0);
    });

    test("ccreq with model name containing dots (e.g. gemini-1.5-pro) is parsed correctly", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:pqr678 | success | gemini-1.5-pro | 1100ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.byChatModel.get("gemini-1.5-pro"), 1);
    });

    test("ccreq with model name containing slash (e.g. meta/llama-3.1) is parsed correctly", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:stu901 | success | meta/llama-3.1-70b | 2000ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.byChatModel.get("meta/llama-3.1-70b"), 1);
    });

    test("fetchCompletions engine URL with dots in model name is captured", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4.5/completions finished with 200 status after 290ms",
        stats,
      );
      assert.strictEqual(stats.totalShown, 1);
      assert.deepStrictEqual(stats.byModel.get("gpt-4.5"), { shown: 1, accepted: 0 });
    });

    test("accumulates counts across multiple chat models", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:a | success | gpt-4o | 700ms | [vscodePrompt]", stats);
      parseTextLogLine("2024-06-01 ccreq:b | success | gpt-4o | 800ms | [panel/editAgent]", stats);
      parseTextLogLine("2024-06-01 ccreq:c | success | claude-3.5-sonnet | 1000ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.totalChat, 3);
      assert.strictEqual(stats.byChatModel.get("gpt-4o"), 2);
      assert.strictEqual(stats.byChatModel.get("claude-3.5-sonnet"), 1);
    });
  });

  suite("parseTextLogLine – ccreq chat session state tracking", () => {
    test("chat request increments chatSessionStates turnCount", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "sess-abc";
      parseTextLogLine("2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      const state = stats.chatSessionStates.get("sess-abc");
      assert.ok(state, "chatSessionStates entry should exist");
      assert.strictEqual(state.turnCount, 1);
      assert.strictEqual(state.isAccepted, false);
    });

    test("multiple chat requests accumulate turnCount in same session", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "sess-multi";
      parseTextLogLine("2024-06-01 ccreq:a | success | gpt-4o | 700ms | [vscodePrompt]", stats);
      parseTextLogLine("2024-06-01 ccreq:b | success | gpt-4o | 800ms | [panel/editAgent]", stats);
      parseTextLogLine("2024-06-01 ccreq:c | success | gpt-4o | 900ms | [vscodePrompt]", stats);
      const state = stats.chatSessionStates.get("sess-multi");
      assert.ok(state);
      assert.strictEqual(state.turnCount, 3);
    });

    test("NES accepted line sets isAccepted true on session", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "sess-nes";
      parseTextLogLine("2024-06-01 ccreq:x | success | copilot-suggestions | 750ms | [nes.nextCursorPosition]", stats);
      const state = stats.chatSessionStates.get("sess-nes");
      assert.ok(state, "chatSessionStates entry should exist for NES accepted");
      assert.strictEqual(state.isAccepted, true);
      assert.strictEqual(state.turnCount, 0);
    });

    test("XtabProvider shown does not update chatSessionStates", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "sess-xtab";
      parseTextLogLine("2024-06-01 ccreq:y | success | gpt-4o | 120ms | [XtabProvider]", stats);
      assert.strictEqual(stats.chatSessionStates.size, 0);
    });

    test("empty currentSessionId does not create chatSessionStates entry", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "";
      parseTextLogLine("2024-06-01 ccreq:z | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.chatSessionStates.size, 0);
    });
  });

  suite("parseTextLogLine – error tracking", () => {
    test("ccreq error line increments totalErrors", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:abc123 | error | gpt-4o | 0ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.totalErrors, 1);
      assert.strictEqual(stats.errorsByType.get("Error"), 1);
      assert.strictEqual(stats.totalChat, 0);
    });

    test("ccreq timeout line increments totalErrors", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:def456 | timeout | gpt-4o | 30000ms | [panel/editAgent]", stats);
      assert.strictEqual(stats.totalErrors, 1);
      assert.strictEqual(stats.errorsByType.get("Timeout"), 1);
    });

    test("ccreq cancelled line increments totalErrors", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:ghi789 | cancelled | gpt-4o | 500ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.totalErrors, 1);
      assert.strictEqual(stats.errorsByType.get("Cancelled"), 1);
    });

    test("fetchCompletions non-200 status increments totalErrors", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4o/completions finished with 429 status after 50ms",
        stats,
      );
      assert.strictEqual(stats.totalErrors, 1);
      assert.strictEqual(stats.errorsByType.get("HTTP 429"), 1);
      assert.strictEqual(stats.totalShown, 0);
    });

    test("fetchCompletions 500 status tracked as error", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4o/completions finished with 500 status after 100ms",
        stats,
      );
      assert.strictEqual(stats.totalErrors, 1);
      assert.strictEqual(stats.errorsByType.get("HTTP 500"), 1);
    });
  });

  suite("parseTextLogLine – chat latency and activity tracking", () => {
    test("ccreq chat line records chat latency", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.chatLatencySum, 800);
      assert.strictEqual(stats.chatLatencyCount, 1);
      assert.strictEqual(stats.chatLatencies.length, 1);
      assert.strictEqual(stats.chatLatencies[0], 800);
    });

    test("ccreq chat line records chatByDate", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [panel/editAgent]", stats);
      assert.strictEqual(stats.chatByDate.get("2024-06-01"), 1);
    });

    test("ccreq chat line records chatByHour", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 14:30:00 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.chatByHour.get("14"), 1);
    });

    test("ccreq inline line records byHour", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 09:15:00 ccreq:mno345 | success | gpt-4o | 120ms | [XtabProvider]", stats);
      assert.strictEqual(stats.byHour.get("09"), 1);
    });

    test("fetchCompletions 200 records latency in latencies array", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4.5/completions finished with 200 status after 290ms",
        stats,
      );
      assert.strictEqual(stats.latencies.length, 1);
      assert.strictEqual(stats.latencies[0], 290);
    });

    test("inline ccreq records latency in latencies array", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:mno345 | success | gpt-4o | 150ms | [XtabProvider]", stats);
      assert.strictEqual(stats.latencies.length, 1);
      assert.strictEqual(stats.latencies[0], 150);
    });
  });

  suite("parseTextLogLine – session tracking", () => {
    test("tracks session stats when currentSessionId is set", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "session-001";
      parseTextLogLine(
        "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4o/completions finished with 200 status after 200ms",
        stats,
      );
      parseTextLogLine("2024-06-01 ccreq:abc | success | gpt-4o | 100ms | [XtabProvider]", stats);
      parseTextLogLine("2024-06-01 ccreq:xyz | success | gpt-4o | 80ms | [nes.nextCursorPosition]", stats);
      parseTextLogLine("2024-06-01 ccreq:def | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      const session = stats.bySession.get("session-001");
      assert.ok(session);
      assert.strictEqual(session.shown, 2);
      assert.strictEqual(session.accepted, 1);
      assert.strictEqual(session.chat, 1);
    });

    test("tracks errors in session stats", () => {
      const stats = makeEmptyStats();
      stats.currentSessionId = "session-002";
      parseTextLogLine("2024-06-01 ccreq:abc | error | gpt-4o | 0ms | [vscodePrompt]", stats);
      const session = stats.bySession.get("session-002");
      assert.ok(session);
      assert.strictEqual(session.errors, 1);
    });

    test("does not track session when currentSessionId is empty", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4o/completions finished with 200 status after 200ms",
        stats,
      );
      assert.strictEqual(stats.bySession.size, 0);
    });
  });

  suite("normalizeContextSource", () => {
    test("maps openTab variants to 'Open Tabs'", () => {
      assert.strictEqual(normalizeContextSource("openTab"), "Open Tabs");
      assert.strictEqual(normalizeContextSource("openTabs"), "Open Tabs");
      assert.strictEqual(normalizeContextSource("open-tab"), "Open Tabs");
      assert.strictEqual(normalizeContextSource("open tab"), "Open Tabs");
    });

    test("maps workspace variants to 'Workspace'", () => {
      assert.strictEqual(normalizeContextSource("workspace"), "Workspace");
      assert.strictEqual(normalizeContextSource("workspaceFile"), "Workspace");
      assert.strictEqual(normalizeContextSource("workspaceIndex"), "Workspace");
      assert.strictEqual(normalizeContextSource("repoSearch"), "Workspace");
      assert.strictEqual(normalizeContextSource("WorkspaceChunkSearchService"), "Workspace");
      assert.strictEqual(normalizeContextSource("GithubAvailableEmbeddingTypesManager"), "Workspace");
      assert.strictEqual(normalizeContextSource("embedding"), "Workspace");
    });

    test("maps mcp/external variants to 'MCP / External Docs'", () => {
      assert.strictEqual(normalizeContextSource("mcp"), "MCP / External Docs");
      assert.strictEqual(normalizeContextSource("externalDoc"), "MCP / External Docs");
    });

    test("maps currentFile variants to 'Current File'", () => {
      assert.strictEqual(normalizeContextSource("currentFile"), "Current File");
      assert.strictEqual(normalizeContextSource("current"), "Current File");
    });

    test("maps snippet to 'Snippet'", () => {
      assert.strictEqual(normalizeContextSource("snippet"), "Snippet");
    });

    test("returns raw string for unknown types, empty string for empty input", () => {
      assert.strictEqual(normalizeContextSource("unknown"), "unknown");
      assert.strictEqual(normalizeContextSource("myCustomSource"), "myCustomSource");
      assert.strictEqual(normalizeContextSource(""), "");
    });
  });

  suite("Context Window Insights – JSON parsing", () => {
    test("parses contextItems array with type field", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "suggestion_shown",
          contextItems: [{ type: "openTab" }, { type: "openTab" }, { type: "workspace" }],
        },
        stats,
      );
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 2);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("parses references array with kind field", () => {
      const stats = makeEmptyStats();
      processJsonEntry(
        {
          event: "suggestion_shown",
          references: [{ kind: "mcp" }, { kind: "openTab" }],
        },
        stats,
      );
      assert.strictEqual(stats.byContextSource.get("MCP / External Docs"), 1);
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 1);
    });

    test("parses usedContext array", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", usedContext: [{ type: "currentFile" }] }, stats);
      assert.strictEqual(stats.byContextSource.get("Current File"), 1);
    });

    test("parses direct contextType string field", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", contextType: "workspaceFile" }, stats);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("parses sourceType string field", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", sourceType: "openTab" }, stats);
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 1);
    });

    test("stores unknown context types under their raw name", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", contextItems: [{ type: "unknown_source" }] }, stats);
      assert.strictEqual(stats.byContextSource.get("unknown_source"), 1);
    });

    test("ignores non-array contextItems", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", contextItems: "openTab" }, stats);
      assert.strictEqual(stats.byContextSource.size, 0);
    });
  });

  suite("Context Window Insights – text log parsing", () => {
    test("[ContextProvider] openTab line recorded", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 [ContextProvider] added openTab: src/app.ts", stats);
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 1);
    });

    test("[ContextProvider] workspace line recorded", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 [ContextProvider] fetching workspace context", stats);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("[ContextProvider] mcp line recorded", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 [ContextProvider] resolving mcp reference", stats);
      assert.strictEqual(stats.byContextSource.get("MCP / External Docs"), 1);
    });

    test("context source: workspace line recorded", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 context source: workspace index", stats);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("context from openTab line recorded", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 context from openTab file.ts", stats);
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 1);
    });

    test("any line with 'context' and a known source keyword is recorded (relaxed prefix)", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 loading context for currentFile", stats);
      assert.strictEqual(stats.byContextSource.get("Current File"), 1);
    });

    test("context line with no known source keyword is counted as 'Unknown Context'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 some unrelated log context", stats);
      assert.strictEqual(stats.byContextSource.get("Unknown Context"), 1);
    });

    test("accumulates multiple context source mentions", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 [ContextProvider] added openTab: a.ts", stats);
      parseTextLogLine("2024-06-01 [ContextProvider] added openTab: b.ts", stats);
      parseTextLogLine("2024-06-01 [ContextProvider] workspace context loaded", stats);
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 2);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("WorkspaceChunkSearchService line (no 'context' word) recorded as Workspace", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 WorkspaceChunkSearchService queried 5 chunks", stats);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("GithubAvailableEmbeddingTypesManager line (no 'context' word) recorded as Workspace", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 GithubAvailableEmbeddingTypesManager: type=code initialized", stats);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("reposearch line (no 'context' word) recorded as Workspace", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 running reposearch query for symbols", stats);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
    });

    test("line with 'context' but no source keyword counted as 'Unknown Context'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 preparing context window for request", stats);
      assert.strictEqual(stats.byContextSource.get("Unknown Context"), 1);
    });
  });

  suite("Subagent / Agentic activity tracking", () => {
    test("detects runSubagent intent and increments subagentRequests", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:abc123 | success | gpt-4o | 1500ms | [tool/runSubagent]", stats);
      assert.strictEqual(stats.subagentRequests, 1);
      assert.strictEqual(stats.toolUsageStats.get("runSubagent"), 1);
    });

    test("detects editAgent intent and increments subagentRequests", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:def456 | success | gpt-4o | 800ms | [panel/editAgent]", stats);
      assert.strictEqual(stats.subagentRequests, 1);
      assert.strictEqual(stats.toolUsageStats.get("editAgent"), 1);
    });

    test("detects searchSubagentTool intent and increments subagentRequests", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 10:00:00.000 ccreq:ghi789 | success | gpt-4o | 600ms | [tool/searchSubagentTool]",
        stats,
      );
      assert.strictEqual(stats.subagentRequests, 1);
      assert.strictEqual(stats.toolUsageStats.get("searchSubagentTool"), 1);
    });

    test("accumulates multiple subagent requests across intents", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:00:01.000 ccreq:b | success | gpt-4o | 900ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:00:02.000 ccreq:c | success | gpt-4o | 800ms | [panel/editAgent]", stats);
      assert.strictEqual(stats.subagentRequests, 3);
      assert.strictEqual(stats.toolUsageStats.get("runSubagent"), 2);
      assert.strictEqual(stats.toolUsageStats.get("editAgent"), 1);
    });

    test("non-subagent chat intents do not increment subagentRequests", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:xyz | success | gpt-4o | 500ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.subagentRequests, 0);
      assert.strictEqual(stats.toolUsageStats.size, 0);
    });

    test("detects tool/runSubagent-Explore intent and increments subagentRequests", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 10:00:00.000 ccreq:3f21ad7f.copilotmd | success | claude-haiku-4.5 -> claude-haiku-4-5-20251001 | 3236ms | [tool/runSubagent-Explore]",
        stats,
      );
      assert.strictEqual(stats.subagentRequests, 1);
      assert.strictEqual(stats.toolUsageStats.get("runSubagent-Explore"), 1);
    });

    test("tool/runSubagent-Explore is tracked in subagentByModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 10:00:00.000 ccreq:5651ba39.copilotmd | success | claude-haiku-4.5 -> claude-haiku-4-5-20251001 | 33641ms | [tool/runSubagent-Explore]",
        stats,
      );
      assert.ok(stats.subagentByModel.size > 0, "subagentByModel should have an entry");
    });

    test("tool/runSubagent-ToolCaller variant also counts as subagent intent", () => {
      const stats = makeEmptyStats();
      parseTextLogLine(
        "2024-06-01 10:00:00.000 ccreq:aabbcc | success | gpt-4o | 2000ms | [tool/runSubagent-ToolCaller]",
        stats,
      );
      assert.strictEqual(stats.subagentRequests, 1);
    });

    test("ToolCallingLoop stop line closes active loop and accumulates autonomousDurationMs", () => {
      const stats = makeEmptyStats();
      // Start a subagent loop
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      assert.notStrictEqual(stats.activeSubagentLoop, null);
      // End the loop
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      assert.strictEqual(stats.activeSubagentLoop, null);
      assert.ok(stats.autonomousDurationMs > 0, "autonomousDurationMs should be > 0 after loop ends");
    });

    test("agentic loop tracking also updates per-date counters and durations", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:00:01.000 ccreq:b | success | gpt-4o | 900ms | [panel/editAgent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );

      assert.strictEqual(stats.loopsStartedByDate.get("2024-06-01"), 1);
      assert.strictEqual(stats.loopsCompletedByDate.get("2024-06-01"), 1);
      assert.strictEqual(stats.totalLoopActionsByDate.get("2024-06-01"), 2);
      assert.ok((stats.autonomousDurationByDate.get("2024-06-01") ?? 0) > 0);
      const dist = stats.loopDistributionByDate.get("2024-06-01");
      assert.ok(dist);
      assert.strictEqual(dist?.bucket2, 1);
    });

    test("ToolCallingLoop stop line without active loop does not throw", () => {
      const stats = makeEmptyStats();
      assert.doesNotThrow(() => {
        parseTextLogLine(
          "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
          stats,
        );
      });
      assert.strictEqual(stats.autonomousDurationMs, 0);
    });

    test("ToolCallingLoop stop increments subagentLoops", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      assert.strictEqual(stats.subagentLoops, 1);
    });

    test("subagentLoops counts distinct completed loop episodes", () => {
      const stats = makeEmptyStats();
      // First loop
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      // Second loop
      parseTextLogLine("2024-06-01 10:01:00.000 ccreq:b | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:01:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      assert.strictEqual(stats.subagentLoops, 2);
    });

    test("subagentByModel tracks per-model subagent calls", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:00:01.000 ccreq:b | success | gpt-4o | 900ms | [panel/editAgent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:02.000 ccreq:c | success | claude-3-sonnet | 800ms | [tool/runSubagent]",
        stats,
      );
      assert.strictEqual(stats.subagentByModel.get("gpt-4o"), 2);
      assert.strictEqual(stats.subagentByModel.get("claude-3-sonnet"), 1);
    });

    test("non-subagent intent lines do not appear in subagentByModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:x | success | gpt-4o | 500ms | [vscodePrompt]", stats);
      assert.strictEqual(stats.subagentByModel.size, 0);
    });

    test("parseLogContent processes subagent lines across content", async () => {
      const stats = makeEmptyStats();
      const content = [
        "2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]",
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
      ].join("\n");
      await parseLogContent(content, stats);
      assert.strictEqual(stats.subagentRequests, 1);
      assert.strictEqual(stats.subagentLoops, 1);
      assert.strictEqual(stats.subagentByModel.get("gpt-4o"), 1);
      assert.strictEqual(stats.activeSubagentLoop, null);
      assert.ok(stats.autonomousDurationMs >= 0);
    });

    test("loopsStartedByModel is incremented when a new loop starts", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      assert.strictEqual(stats.loopsStartedByModel.get("gpt-4o"), 1);
    });

    test("activeSubagentLoopActionCount increments for each action in a loop", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      assert.strictEqual(stats.activeSubagentLoopActionCount, 1);
      parseTextLogLine("2024-06-01 10:00:01.000 ccreq:b | success | gpt-4o | 900ms | [panel/editAgent]", stats);
      assert.strictEqual(stats.activeSubagentLoopActionCount, 2);
      parseTextLogLine("2024-06-01 10:00:02.000 ccreq:c | success | gpt-4o | 800ms | [tool/runSubagent]", stats);
      assert.strictEqual(stats.activeSubagentLoopActionCount, 3);
    });

    test("loop stop records action count in loopDistributionByModel (bucket1)", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      const dist = stats.loopDistributionByModel.get("gpt-4o");
      assert.ok(dist, "distribution should exist for gpt-4o");
      assert.strictEqual(dist.bucket1, 1);
      assert.strictEqual(dist.bucket2, 0);
      assert.strictEqual(dist.bucket3to5, 0);
    });

    test("loop stop records action count in loopDistributionByModel (bucket3to5)", () => {
      const stats = makeEmptyStats();
      // 4 actions in the loop
      for (let i = 0; i < 4; i++) {
        parseTextLogLine(
          `2024-06-01 10:00:0${i}.000 ccreq:${i} | success | claude-3.5 | 1000ms | [tool/runSubagent]`,
          stats,
        );
      }
      parseTextLogLine(
        "2024-06-01 10:00:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      const dist = stats.loopDistributionByModel.get("claude-3.5");
      assert.ok(dist, "distribution should exist for claude-3.5");
      assert.strictEqual(dist.bucket3to5, 1);
      assert.strictEqual(dist.bucket1, 0);
    });

    test("loop stop records action count in loopDistributionByModel (bucket6to10)", () => {
      const stats = makeEmptyStats();
      for (let i = 0; i < 7; i++) {
        parseTextLogLine(
          `2024-06-01 10:00:0${i}.000 ccreq:${i} | success | gpt-4o | 1000ms | [tool/runSubagent]`,
          stats,
        );
      }
      parseTextLogLine(
        "2024-06-01 10:00:20.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      const dist = stats.loopDistributionByModel.get("gpt-4o");
      assert.ok(dist);
      assert.strictEqual(dist.bucket6to10, 1);
    });

    test("loop stop records action count in loopDistributionByModel (bucket11plus)", () => {
      const stats = makeEmptyStats();
      for (let i = 0; i < 12; i++) {
        parseTextLogLine(
          `2024-06-01 10:00:${String(i).padStart(2, "0")}.000 ccreq:${i} | success | gpt-4o | 1000ms | [tool/runSubagent]`,
          stats,
        );
      }
      parseTextLogLine(
        "2024-06-01 10:01:00.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      const dist = stats.loopDistributionByModel.get("gpt-4o");
      assert.ok(dist);
      assert.strictEqual(dist.bucket11plus, 1);
    });

    test("loopsCompletedByModel and totalLoopActionsByModel are updated on loop stop", () => {
      const stats = makeEmptyStats();
      // Loop with 3 actions
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:00:01.000 ccreq:b | success | gpt-4o | 900ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:00:02.000 ccreq:c | success | gpt-4o | 800ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      assert.strictEqual(stats.loopsCompletedByModel.get("gpt-4o"), 1);
      assert.strictEqual(stats.totalLoopActionsByModel.get("gpt-4o"), 3);
      assert.strictEqual(stats.activeSubagentLoopActionCount, 0);
    });

    test("activeSubagentLoopActionCount resets to 0 after loop stop", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      assert.strictEqual(stats.activeSubagentLoopActionCount, 0);
    });

    test("two sequential loops accumulate histogram across loops", () => {
      const stats = makeEmptyStats();
      // First loop: 1 action → bucket1
      parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      // Second loop: 2 actions → bucket2
      parseTextLogLine("2024-06-01 10:01:00.000 ccreq:b | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
      parseTextLogLine("2024-06-01 10:01:01.000 ccreq:c | success | gpt-4o | 900ms | [tool/runSubagent]", stats);
      parseTextLogLine(
        "2024-06-01 10:01:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
        stats,
      );
      const dist = stats.loopDistributionByModel.get("gpt-4o");
      assert.ok(dist);
      assert.strictEqual(dist.bucket1, 1);
      assert.strictEqual(dist.bucket2, 1);
      assert.strictEqual(stats.loopsCompletedByModel.get("gpt-4o"), 2);
      assert.strictEqual(stats.totalLoopActionsByModel.get("gpt-4o"), 3);
    });
  });
});

suite("normalizeModelName", () => {
  test("returns model name unchanged when no deployment path", () => {
    assert.strictEqual(normalizeModelName("gpt-4o"), "gpt-4o");
  });

  test("strips ' -> ' and everything after it", () => {
    assert.strictEqual(normalizeModelName("claude-sonnet-4.6 -> azure/some/deployment"), "claude-sonnet-4.6");
  });

  test("trims surrounding whitespace", () => {
    assert.strictEqual(normalizeModelName("  gpt-4o  "), "gpt-4o");
  });

  test("returns empty string for empty input", () => {
    assert.strictEqual(normalizeModelName(""), "");
  });

  test("handles model with version number like gemini-1.5-pro", () => {
    assert.strictEqual(normalizeModelName("gemini-1.5-pro"), "gemini-1.5-pro");
  });

  test("strips deployment path from model with version", () => {
    assert.strictEqual(normalizeModelName("claude-3.5-sonnet -> gcp/us-east1/v1"), "claude-3.5-sonnet");
  });

  // Rule 2: colon suffix stripping
  test("strips colon version suffix", () => {
    assert.strictEqual(normalizeModelName("gpt-5-mini:20241101"), "gpt-5-mini");
  });

  test("strips colon date suffix after arrow removal", () => {
    assert.strictEqual(normalizeModelName("gpt-4o -> gpt-4o:2024-11-20"), "gpt-4o");
  });

  test("strips hash suffix", () => {
    assert.strictEqual(normalizeModelName("claude-3.5-sonnet#abc123"), "claude-3.5-sonnet");
  });

  test("does not strip leading colon (edge case)", () => {
    assert.strictEqual(normalizeModelName(":weird"), ":weird");
  });

  test("does not strip leading hash (edge case)", () => {
    assert.strictEqual(normalizeModelName("#weird"), "#weird");
  });

  // Rule 4: -copilot vendor suffix stripping
  test("strips -copilot vendor suffix", () => {
    assert.strictEqual(normalizeModelName("gpt-41-copilot"), "gpt-41");
  });

  test("strips -copilot suffix case-insensitively", () => {
    assert.strictEqual(normalizeModelName("gpt-41-Copilot"), "gpt-41");
  });

  test("strips -copilot suffix after arrow removal", () => {
    assert.strictEqual(normalizeModelName("gpt-41-copilot -> azure/eastus"), "gpt-41");
  });

  test("does not strip -copilot when it is not a suffix", () => {
    // "copilot" appears in the middle but is not a trailing -copilot suffix
    assert.strictEqual(normalizeModelName("copilot-model"), "copilot-model");
  });

  test("does not strip -copilot when it is embedded in the middle", () => {
    // '-copilot' in the middle should not be stripped
    assert.strictEqual(normalizeModelName("model-copilot-v2"), "model-copilot-v2");
  });
});

suite("model name normalization in ccreq parsing", () => {
  test("ccreq line with deployment path normalizes model name", () => {
    const stats = makeEmptyStats();
    parseTextLogLine(
      "2024-06-01 ccreq:a | success | claude-sonnet-4.6 -> azure/some/deployment | 800ms | [vscodePrompt]",
      stats,
    );
    assert.strictEqual(stats.byChatModel.has("claude-sonnet-4.6"), true);
    assert.strictEqual(stats.byChatModel.has("claude-sonnet-4.6 -> azure/some/deployment"), false);
  });

  test("ccreq subagent line with deployment path normalizes model in subagentByModel", () => {
    const stats = makeEmptyStats();
    parseTextLogLine(
      "2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o -> openai/eastus | 1000ms | [tool/runSubagent]",
      stats,
    );
    assert.strictEqual(stats.subagentByModel.has("gpt-4o"), true);
    assert.strictEqual(stats.subagentByModel.has("gpt-4o -> openai/eastus"), false);
  });
});

suite("subagentLoopsStarted and completionRate tracking", () => {
  test("subagentLoopsStarted increments when first subagent request seen", () => {
    const stats = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
    assert.strictEqual(stats.subagentLoopsStarted, 1);
  });

  test("subsequent subagent requests in same loop do not increment subagentLoopsStarted", () => {
    const stats = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
    parseTextLogLine("2024-06-01 10:00:01.000 ccreq:b | success | gpt-4o | 900ms | [tool/runSubagent]", stats);
    assert.strictEqual(stats.subagentLoopsStarted, 1);
  });

  test("subagentLoopsStarted increments for each new loop start", () => {
    const stats = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
    parseTextLogLine(
      "2024-06-01 10:00:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
      stats,
    );
    parseTextLogLine("2024-06-01 10:01:00.000 ccreq:b | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
    assert.strictEqual(stats.subagentLoopsStarted, 2);
  });
});

suite("autonomousDurationByModel tracking", () => {
  test("accumulates per-model autonomous duration on loop completion", () => {
    const stats = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]", stats);
    parseTextLogLine(
      "2024-06-01 10:00:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
      stats,
    );
    assert.ok((stats.autonomousDurationByModel.get("gpt-4o") ?? 0) > 0, "should have gpt-4o duration");
  });

  test("does not accumulate duration when no model is associated with the loop", () => {
    const stats = makeEmptyStats();
    // shouldContinue=false without a prior subagent request
    parseTextLogLine(
      "2024-06-01 10:00:10.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
      stats,
    );
    assert.strictEqual(stats.autonomousDurationByModel.size, 0);
  });

  test("accumulated duration matches the loop interval", () => {
    const stats = makeEmptyStats();
    parseTextLogLine(
      "2024-06-01 10:00:00.000 ccreq:a | success | claude-3.5-sonnet | 1000ms | [tool/runSubagent]",
      stats,
    );
    parseTextLogLine(
      "2024-06-01 10:00:30.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
      stats,
    );
    assert.strictEqual(stats.autonomousDurationByModel.get("claude-3.5-sonnet"), 30000);
  });
});

suite("mergeStatsByNormalizedModel", () => {
  test("returns an empty map for empty input", () => {
    const result = mergeStatsByNormalizedModel(new Map());
    assert.strictEqual(result.size, 0);
  });

  test("preserves a single entry with a clean key", () => {
    const source = new Map([["gpt-4o", { shown: 10, accepted: 7 }]]);
    const result = mergeStatsByNormalizedModel(source);
    assert.deepStrictEqual(result.get("gpt-4o"), { shown: 10, accepted: 7 });
  });

  test("merges two entries that normalize to the same key", () => {
    const source = new Map([
      ["gpt-4o -> deployment-a", { shown: 10, accepted: 6 }],
      ["gpt-4o -> deployment-b", { shown: 5, accepted: 3 }],
    ]);
    const result = mergeStatsByNormalizedModel(source);
    assert.strictEqual(result.size, 1);
    assert.deepStrictEqual(result.get("gpt-4o"), { shown: 15, accepted: 9 });
  });

  test("strips colon suffix and merges", () => {
    const source = new Map([
      ["claude-3.5-sonnet:20241022", { shown: 8, accepted: 5 }],
      ["claude-3.5-sonnet:20241101", { shown: 4, accepted: 2 }],
    ]);
    const result = mergeStatsByNormalizedModel(source);
    assert.strictEqual(result.size, 1);
    assert.deepStrictEqual(result.get("claude-3.5-sonnet"), { shown: 12, accepted: 7 });
  });

  test("keeps distinct entries that normalize to different keys", () => {
    const source = new Map([
      ["gpt-4o -> dep", { shown: 10, accepted: 6 }],
      ["claude-3.5-sonnet -> dep", { shown: 5, accepted: 3 }],
    ]);
    const result = mergeStatsByNormalizedModel(source);
    assert.strictEqual(result.size, 2);
    assert.ok(result.has("gpt-4o"));
    assert.ok(result.has("claude-3.5-sonnet"));
  });
});

suite("mergeCountByNormalizedModel", () => {
  test("returns an empty map for empty input", () => {
    const result = mergeCountByNormalizedModel(new Map());
    assert.strictEqual(result.size, 0);
  });

  test("preserves a single entry with a clean key", () => {
    const source = new Map([["gpt-4o", 20]]);
    const result = mergeCountByNormalizedModel(source);
    assert.strictEqual(result.get("gpt-4o"), 20);
  });

  test("merges counts for entries that normalize to the same key", () => {
    const source = new Map([
      ["gpt-4o -> deployment-a", 8],
      ["gpt-4o -> deployment-b", 5],
    ]);
    const result = mergeCountByNormalizedModel(source);
    assert.strictEqual(result.size, 1);
    assert.strictEqual(result.get("gpt-4o"), 13);
  });

  test("strips hash suffix and merges", () => {
    const source = new Map([
      ["claude-3#hash1", 3],
      ["claude-3#hash2", 2],
    ]);
    const result = mergeCountByNormalizedModel(source);
    assert.strictEqual(result.size, 1);
    assert.strictEqual(result.get("claude-3"), 5);
  });
});

suite("processJsonEntry model extraction", () => {
  test("records model in byModel.shown for a 'shown' event", () => {
    const stats = makeEmptyStats();
    processJsonEntry({ event: "completionShown", model: "gpt-4o", timestamp: "2024-06-01T10:00:00Z" }, stats);
    assert.deepStrictEqual(stats.byModel.get("gpt-4o"), { shown: 1, accepted: 0 });
  });

  test("records model in byModel.accepted for an 'accepted' event", () => {
    const stats = makeEmptyStats();
    processJsonEntry({ event: "completionAccepted", model: "gpt-4o", timestamp: "2024-06-01T10:00:00Z" }, stats);
    assert.deepStrictEqual(stats.byModel.get("gpt-4o"), { shown: 0, accepted: 1 });
  });

  test("records model in byChatModel for a non-shown/accepted event", () => {
    const stats = makeEmptyStats();
    processJsonEntry({ event: "chatRequest", model: "claude-3.5-sonnet", timestamp: "2024-06-01T10:00:00Z" }, stats);
    assert.strictEqual(stats.byChatModel.get("claude-3.5-sonnet"), 1);
  });

  test("normalizes model name in JSON entry (strips arrow suffix)", () => {
    const stats = makeEmptyStats();
    processJsonEntry(
      { event: "completionShown", model: "gpt-4o -> azure/dep", timestamp: "2024-06-01T10:00:00Z" },
      stats,
    );
    assert.ok(stats.byModel.has("gpt-4o"), "should have normalized key gpt-4o");
    assert.ok(!stats.byModel.has("gpt-4o -> azure/dep"), "should not have raw key");
  });

  test("normalizes model name with colon suffix in JSON entry", () => {
    const stats = makeEmptyStats();
    processJsonEntry(
      { event: "completionShown", model: "gpt-5-mini:20241101", timestamp: "2024-06-01T10:00:00Z" },
      stats,
    );
    assert.ok(stats.byModel.has("gpt-5-mini"));
    assert.ok(!stats.byModel.has("gpt-5-mini:20241101"));
  });

  test("falls back to modelId when model field is absent", () => {
    const stats = makeEmptyStats();
    processJsonEntry({ event: "completionShown", modelId: "gemini-1.5-pro", timestamp: "2024-06-01T10:00:00Z" }, stats);
    assert.ok(stats.byModel.has("gemini-1.5-pro"));
  });

  test("does not record model in byModel when model field is absent from a shown event", () => {
    const stats = makeEmptyStats();
    processJsonEntry({ event: "completionShown", timestamp: "2024-06-01T10:00:00Z" }, stats);
    assert.strictEqual(stats.byModel.size, 0);
  });

  test("does not record model in byChatModel for a 'rejected' event", () => {
    const stats = makeEmptyStats();
    processJsonEntry({ event: "completionRejected", model: "gpt-4o", timestamp: "2024-06-01T10:00:00Z" }, stats);
    assert.strictEqual(stats.byChatModel.size, 0);
    assert.strictEqual(stats.byModel.size, 0);
  });
});

suite("planning stats", () => {
  test("planCount increments on agent/plan text line", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00 [Agent] agent/plan proposed for task X", ctx);
    assert.strictEqual(ctx.planCount, 1);
  });

  test("planCount increments on strategy/propose text line", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00 [Strategy] strategy/propose applied", ctx);
    assert.strictEqual(ctx.planCount, 1);
  });

  test("executedPlanCount increments when workspace/editFile follows a plan", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00 agent/plan", ctx);
    parseTextLogLine("2024-06-01 10:00:01 workspace/editFile src/main.ts", ctx);
    assert.strictEqual(ctx.planCount, 1);
    assert.strictEqual(ctx.executedPlanCount, 1);
  });

  test("executedPlanCount increments when apply_patch follows a plan", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00 agent/plan", ctx);
    parseTextLogLine("2024-06-01 10:00:01 apply_patch to file", ctx);
    assert.strictEqual(ctx.executedPlanCount, 1);
  });

  test("executedPlanCount does not increment when editFile appears with no preceding plan", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:01 workspace/editFile src/main.ts", ctx);
    assert.strictEqual(ctx.executedPlanCount, 0);
  });

  test("activePlanPending is cleared after editFile follows plan", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00 agent/plan", ctx);
    assert.strictEqual(ctx.activePlanPending, true);
    parseTextLogLine("2024-06-01 10:00:01 workspace/editFile src/main.ts", ctx);
    assert.strictEqual(ctx.activePlanPending, false);
  });

  test("userChoicesInPlan increments on choice_selected text line", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("2024-06-01 10:00:00 user choice_selected option A", ctx);
    assert.strictEqual(ctx.userChoicesInPlan, 1);
  });

  test("plan from JSON event increments planCount", () => {
    const ctx = makeEmptyStats();
    processJsonEntry({ event: "agent/plan", timestamp: "2024-06-01T10:00:00Z" }, ctx);
    assert.strictEqual(ctx.planCount, 1);
  });

  test("apply_patch from JSON event triggers executedPlanCount after plan", () => {
    const ctx = makeEmptyStats();
    processJsonEntry({ event: "agent/plan", timestamp: "2024-06-01T10:00:00Z" }, ctx);
    processJsonEntry({ event: "apply_patch", timestamp: "2024-06-01T10:00:01Z" }, ctx);
    assert.strictEqual(ctx.executedPlanCount, 1);
  });

  test("multiple plans each independently tracked for execution", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine("agent/plan 1", ctx);
    parseTextLogLine("workspace/editFile a", ctx);
    parseTextLogLine("agent/plan 2", ctx);
    // second plan not yet executed
    assert.strictEqual(ctx.planCount, 2);
    assert.strictEqual(ctx.executedPlanCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Evidence-driven tests: real log lines sampled from WSL environment
// (session 20260228T180728, file exthost82/GitHub.copilot-chat/GitHub Copilot
//  Chat.log) — these tests prove the parser handles the actual log format.
// ---------------------------------------------------------------------------

suite("real log format: ccreq with .copilotmd suffix", () => {
  test("chat ccreq with .copilotmd suffix increments totalChat", () => {
    // Real line: ccreq:4c750e0c.copilotmd | success | gpt-4o-mini -> gpt-4o-mini-2024-07-18 | 748ms | [copilotLanguageModelWrapper]
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-02-28 19:23:06.453 [info] ccreq:4c750e0c.copilotmd | success | gpt-4o-mini -> gpt-4o-mini-2024-07-18 | 748ms | [copilotLanguageModelWrapper]",
      ctx,
    );
    assert.strictEqual(ctx.totalChat, 1);
    assert.strictEqual(ctx.totalAccepted, 0);
    assert.strictEqual(ctx.byChatModel.get("gpt-4o-mini"), 1);
  });

  test("panel/editAgent ccreq increments subagentRequests and starts loop", () => {
    // Real line: ccreq:abbf7348.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 25016ms | [panel/editAgent]
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-02-28 19:25:27.878 [info] ccreq:abbf7348.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 25016ms | [panel/editAgent]",
      ctx,
    );
    assert.strictEqual(ctx.subagentRequests, 1);
    assert.strictEqual(ctx.subagentLoopsStarted, 1);
    assert.strictEqual(ctx.activeSubagentLoop, "2026-02-28 19:25:27.878");
  });

  test("XtabProvider ccreq increments totalShown (inline completion shown)", () => {
    // Real line: ccreq:d2536215.copilotmd | success | copilot-nes-oct | 921ms | [XtabProvider]
    // XtabProvider fetches and displays a suggestion — this is a "Shown" event, not "Accepted".
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-04 19:36:15.954 [info] ccreq:d2536215.copilotmd | success | copilot-nes-oct | 921ms | [XtabProvider]",
      ctx,
    );
    assert.strictEqual(ctx.totalShown, 1);
    assert.strictEqual(ctx.totalAccepted, 0);
    assert.strictEqual(ctx.totalChat, 0);
    assert.strictEqual(ctx.byModel.get("copilot-nes-oct")?.shown, 1);
    assert.strictEqual(ctx.byModel.get("copilot-nes-oct")?.accepted, 0);
  });

  test("nes.nextCursorPosition ccreq increments totalAccepted (inline completion accepted)", () => {
    // Real line: ccreq:5c02644a.copilotmd | success | copilot-suggestions-himalia-001 | 554ms | [nes.nextCursorPosition]
    // nes.nextCursorPosition fires after user accepts (Tab key) — this is the true "Accepted" event.
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-04 19:36:16.514 [info] ccreq:5c02644a.copilotmd | success | copilot-suggestions-himalia-001 | 554ms | [nes.nextCursorPosition]",
      ctx,
    );
    assert.strictEqual(ctx.totalAccepted, 1);
    assert.strictEqual(ctx.totalShown, 0, "nes.nextCursorPosition must not count as shown");
    assert.strictEqual(ctx.totalChat, 0);
  });

  test("ccreq markdown-only line (no success) does not count as chat or accepted", () => {
    // Real line: ccreq:8ff6cb0b.copilotmd | markdown
    const ctx = makeEmptyStats();
    parseTextLogLine("2026-02-28 19:21:47.848 [info] ccreq:8ff6cb0b.copilotmd | markdown", ctx);
    assert.strictEqual(ctx.totalChat, 0);
    assert.strictEqual(ctx.totalAccepted, 0);
    assert.strictEqual(ctx.totalErrors, 0);
  });

  test("'Latest entry: ccreq:latest.copilotmd' line does not count as error", () => {
    // Real line: Latest entry: ccreq:latest.copilotmd
    const ctx = makeEmptyStats();
    parseTextLogLine("2026-02-28 19:21:47.847 [info] Latest entry: ccreq:latest.copilotmd", ctx);
    assert.strictEqual(ctx.totalErrors, 0);
    assert.strictEqual(ctx.totalChat, 0);
  });

  test("negative latency ccreq is handled gracefully (no latency recorded)", () => {
    // Real line: ccreq:20ce1418.copilotmd | success | copilot-nes-oct | -161ms | [XtabProvider]
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-04 19:38:04.104 [info] ccreq:20ce1418.copilotmd | success | copilot-nes-oct | -161ms | [XtabProvider]",
      ctx,
    );
    // Should still count as shown (XtabProvider = shown), but no latency recorded
    assert.strictEqual(ctx.totalShown, 1);
    assert.strictEqual(ctx.totalAccepted, 0);
    assert.strictEqual(ctx.latencies.length, 0);
    assert.strictEqual(ctx.latencyCount, 0);
  });

  test("ccreq with oswe-vscode-prime model extracts model name correctly", () => {
    // Real line: ccreq:520a97e5.copilotmd | success | oswe-vscode-prime -> capi-noe-ptuc-h200-oswe-vscode-prime | 6892ms | [panel/editAgent]
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-04 19:29:37.128 [info] ccreq:520a97e5.copilotmd | success | oswe-vscode-prime -> capi-noe-ptuc-h200-oswe-vscode-prime | 6892ms | [panel/editAgent]",
      ctx,
    );
    // Model: "oswe-vscode-prime -> capi-noe-ptuc-h200-oswe-vscode-prime" normalizes to "oswe-vscode-prime"
    assert.strictEqual(ctx.byChatModel.get("oswe-vscode-prime"), 1);
  });
});

suite("real log format: XtabProvider=Shown vs nes.nextCursorPosition=Accepted", () => {
  test("mixed XtabProvider + nes.nextCursorPosition produces correct shown/accepted counts", () => {
    // Real log sequence: XtabProvider fires first (fetches and shows suggestion),
    // then nes.nextCursorPosition fires after user presses Tab to accept.
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-12 20:02:06.601 [info] ccreq:96bb7a6e.copilotmd | success | copilot-nes-oct | 909ms | [XtabProvider]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-12 20:02:07.145 [info] ccreq:7c403803.copilotmd | success | copilot-suggestions-himalia-001 | 533ms | [nes.nextCursorPosition]",
      ctx,
    );
    assert.strictEqual(ctx.totalShown, 1, "XtabProvider should count as shown");
    assert.strictEqual(ctx.totalAccepted, 1, "nes.nextCursorPosition should count as accepted");
    assert.strictEqual(ctx.totalChat, 0, "neither should count as chat");
  });

  test("multiple XtabProvider lines without nes.nextCursorPosition means shown but not accepted", () => {
    // User saw suggestions but did not accept any.
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-14 11:36:22.951 [info] ccreq:da8d9005.copilotmd | success | copilot-nes-oct | 308ms | [XtabProvider]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-14 11:36:29.893 [info] ccreq:2210e63d.copilotmd | success | copilot-nes-oct | 343ms | [XtabProvider]",
      ctx,
    );
    assert.strictEqual(ctx.totalShown, 2);
    assert.strictEqual(ctx.totalAccepted, 0);
  });

  test("nes.nextCursorPosition records accepted in byDate and byModel", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-12 20:02:07.145 [info] ccreq:7c403803.copilotmd | success | copilot-suggestions-himalia-001 | 533ms | [nes.nextCursorPosition]",
      ctx,
    );
    assert.strictEqual(ctx.totalAccepted, 1);
    assert.strictEqual(ctx.totalShown, 0, "nes.nextCursorPosition must not inflate totalShown");
    assert.strictEqual(ctx.byDate.get("2026-03-12")?.accepted, 1);
    assert.strictEqual(ctx.byDate.get("2026-03-12")?.shown ?? 0, 0);
    assert.strictEqual(ctx.byModel.get("copilot-suggestions-himalia-001")?.accepted, 1);
  });

  test("XtabProvider records shown in byDate and byModel, not accepted", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-14 11:36:22.951 [info] ccreq:da8d9005.copilotmd | success | copilot-nes-oct | 308ms | [XtabProvider]",
      ctx,
    );
    assert.strictEqual(ctx.totalShown, 1);
    assert.strictEqual(ctx.totalAccepted, 0);
    assert.strictEqual(ctx.byDate.get("2026-03-14")?.shown, 1);
    assert.strictEqual(ctx.byDate.get("2026-03-14")?.accepted ?? 0, 0);
    assert.strictEqual(ctx.byModel.get("copilot-nes-oct")?.shown, 1);
    assert.strictEqual(ctx.byModel.get("copilot-nes-oct")?.accepted ?? 0, 0);
  });

  test("realistic session: multiple shown with some accepted yields correct acceptance rate", () => {
    // Simulates a real coding session extracted from actual logs.
    const ctx = makeEmptyStats();
    // Shown 1
    parseTextLogLine(
      "2026-03-13 15:58:04.715 [info] ccreq:222786da.copilotmd | success | copilot-nes-oct | 796ms | [XtabProvider]",
      ctx,
    );
    // Accepted 1 (user pressed Tab)
    parseTextLogLine(
      "2026-03-13 15:58:06.822 [info] ccreq:bd339cfe.copilotmd | success | copilot-suggestions-himalia-001 | 433ms | [nes.nextCursorPosition]",
      ctx,
    );
    // Shown 2
    parseTextLogLine(
      "2026-03-13 15:58:08.024 [info] ccreq:4e88fb4c.copilotmd | success | copilot-nes-oct | 384ms | [XtabProvider]",
      ctx,
    );
    // Shown 3 (user did not accept this one)
    parseTextLogLine(
      "2026-03-14 11:36:17.360 [info] ccreq:2c29e453.copilotmd | success | copilot-nes-oct | 1058ms | [XtabProvider]",
      ctx,
    );

    assert.strictEqual(ctx.totalShown, 3, "three XtabProvider lines = 3 shown");
    assert.strictEqual(ctx.totalAccepted, 1, "one nes.nextCursorPosition = 1 accepted");
    assert.strictEqual(ctx.totalChat, 0);
  });

  test("ccreq success lines (fetchCompletions/chat) are not counted as accepted", () => {
    // Ensures that HTTP 200 completion fetches and chat requests remain correctly classified.
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2024-06-01 [fetchCompletions] Request to /v1/engines/gpt-4o/completions finished with 200 status after 290ms",
      ctx,
    );
    parseTextLogLine("2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]", ctx);
    assert.strictEqual(ctx.totalShown, 1, "fetchCompletions 200 = shown");
    assert.strictEqual(ctx.totalChat, 1, "vscodePrompt ccreq = chat");
    assert.strictEqual(ctx.totalAccepted, 0, "neither should count as accepted");
  });
});

suite("real log format: [fetchCompletions] with angle-bracket URL", () => {
  test("fetchCompletions 200 with gpt-41-copilot in URL increments totalShown", () => {
    // Real line: [fetchCompletions] Request ecf0d455-... at <https://proxy.individual.githubcopilot.com/v1/engines/gpt-41-copilot/completions> finished with 200 status after 349.06ms
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-04 19:36:12.577 [info] [fetchCompletions] Request ecf0d455-0331-42dd-a84e-bee60e578e5d at <https://proxy.individual.githubcopilot.com/v1/engines/gpt-41-copilot/completions> finished with 200 status after 349.06753800000297ms",
      ctx,
    );
    assert.strictEqual(ctx.totalShown, 1);
    assert.strictEqual(ctx.byModel.get("gpt-41-copilot")?.shown, 1);
    assert.ok(ctx.latencyCount > 0, "latency should be recorded");
    assert.ok(ctx.latencies[0] > 300, "latency should be ~349ms");
  });

  test("fetchCompletions 200 increments totalShown and records latency from fractional ms", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-04 19:38:01.133 [info] [fetchCompletions] Request 33d20c0f-eb9d-4b92-9974-7f40ba18f2b7 at <https://proxy.individual.githubcopilot.com/v1/engines/gpt-41-copilot/completions> finished with 200 status after 167.84552699996857ms",
      ctx,
    );
    assert.strictEqual(ctx.totalShown, 1);
    assert.strictEqual(ctx.latencyCount, 1);
  });
});

suite("real log format: [ToolCallingLoop] shouldContinue=false", () => {
  test("real ToolCallingLoop stop line closes loop and computes autonomousDurationMs", () => {
    // Sampled start + stop pair from real session 20260228T180728/exthost82
    const ctx = makeEmptyStats();
    // Start: first panel/editAgent request at 19:29:37.128
    parseTextLogLine(
      "2026-03-04 19:29:37.128 [info] ccreq:520a97e5.copilotmd | success | oswe-vscode-prime -> capi-noe-ptuc-h200-oswe-vscode-prime | 6892ms | [panel/editAgent]",
      ctx,
    );
    assert.strictEqual(ctx.subagentLoopsStarted, 1);
    assert.ok(ctx.activeSubagentLoop !== null, "loop should be active after first editAgent request");

    // Stop: [ToolCallingLoop] Stop hook result: shouldContinue=false, reasons=undefined at 19:32:23.244
    parseTextLogLine(
      "2026-03-04 19:32:23.244 [info] [ToolCallingLoop] Stop hook result: shouldContinue=false, reasons=undefined",
      ctx,
    );
    assert.strictEqual(ctx.subagentLoops, 1, "loop should be completed");
    assert.strictEqual(ctx.activeSubagentLoop, null, "active loop should be cleared");
    // Duration: 19:32:23.244 - 19:29:37.128 = 166,116ms
    assert.ok(ctx.autonomousDurationMs > 160_000, "duration should be ~166s");
    assert.ok(ctx.autonomousDurationMs < 170_000, "duration should be ~166s");
  });

  test("shouldContinue=false with trailing comma and reasons (real format) is detected", () => {
    // Real format includes ', reasons=undefined' suffix — ensure the pattern still matches
    const ctx = makeEmptyStats();
    ctx.activeSubagentLoop = "2026-03-04 19:00:00.000";
    ctx.activeSubagentLoopModel = "test-model";
    ctx.activeSubagentLoopActionCount = 1;
    ctx.subagentLoopsStarted = 1;
    parseTextLogLine(
      "2026-03-04 19:01:00.000 [info] [ToolCallingLoop] Stop hook result: shouldContinue=false, reasons=undefined",
      ctx,
    );
    assert.strictEqual(ctx.subagentLoops, 1);
  });

  test("shouldContinue=false with spaces around equals is also detected (defensive)", () => {
    const ctx = makeEmptyStats();
    ctx.activeSubagentLoop = "2026-03-04 19:00:00.000";
    ctx.activeSubagentLoopModel = "test-model";
    ctx.activeSubagentLoopActionCount = 1;
    ctx.subagentLoopsStarted = 1;
    parseTextLogLine("2026-03-04 19:01:00.000 [info] [ToolCallingLoop] Stop hook result: shouldContinue = false", ctx);
    assert.strictEqual(ctx.subagentLoops, 1);
  });
});

suite("real log format: WorkspaceChunk and MCP context detection", () => {
  test("WorkspaceChunkSearchService line is counted as Workspace context", () => {
    // Real line: WorkspaceChunkSearchService: using embedding type metis-1024-I16-Binary
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-02-28 19:21:46.722 [info] WorkspaceChunkSearchService: using embedding type metis-1024-I16-Binary",
      ctx,
    );
    assert.strictEqual(ctx.byContextSource.get("Workspace"), 1);
  });

  test("MCP server URI line is counted as MCP / External Docs context", () => {
    // Real line: [CopilotCLI] Server URI: unix:/tmp/mcp-PzMmsS/mcp.sock#%2Fmcp
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-02-28 19:21:45.673 [info] [CopilotCLI] Server URI: unix:/tmp/mcp-PzMmsS/mcp.sock#%2Fmcp",
      ctx,
    );
    assert.strictEqual(ctx.byContextSource.get("MCP / External Docs"), 1);
  });
});

suite("real log format: agenticMinutesSaved end-to-end data flow", () => {
  test("autonomousDurationMs accumulates across multiple completed loops", () => {
    const ctx = makeEmptyStats();
    // Loop 1: 1 minute duration
    parseTextLogLine(
      "2026-03-04 19:00:00.000 [info] ccreq:aaaa.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-04 19:01:00.000 [info] [ToolCallingLoop] Stop hook result: shouldContinue=false, reasons=undefined",
      ctx,
    );
    // Loop 2: 2 minute duration
    parseTextLogLine(
      "2026-03-04 19:02:00.000 [info] ccreq:bbbb.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-04 19:04:00.000 [info] [ToolCallingLoop] Stop hook result: shouldContinue=false, reasons=undefined",
      ctx,
    );
    assert.strictEqual(ctx.subagentLoops, 2);
    // 60s + 120s = 180s = 180,000ms
    assert.ok(Math.abs(ctx.autonomousDurationMs - 180_000) < 100, "total duration should be ~180s");
  });
});

suite("planning tracking from ccreq intents", () => {
  test("panel/unknown ccreq increments planCount and sets activePlanPending", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-06 09:00:00.000 [info] ccreq:plan01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 3000ms | [panel/unknown]",
      ctx,
    );
    assert.strictEqual(ctx.planCount, 1);
    assert.strictEqual(ctx.activePlanPending, true);
    assert.strictEqual(ctx.executedPlanCount, 0);
  });

  test("panel/editAgent after panel/unknown increments executedPlanCount and clears activePlanPending", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-06 09:00:00.000 [info] ccreq:plan01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 3000ms | [panel/unknown]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-06 09:00:05.000 [info] ccreq:edit01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    assert.strictEqual(ctx.planCount, 1);
    assert.strictEqual(ctx.executedPlanCount, 1);
    assert.strictEqual(ctx.activePlanPending, false);
  });

  test("panel/editAgent without prior panel/unknown does not increment executedPlanCount", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-06 09:00:00.000 [info] ccreq:edit01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    assert.strictEqual(ctx.planCount, 0);
    assert.strictEqual(ctx.executedPlanCount, 0);
    assert.strictEqual(ctx.activePlanPending, false);
  });

  test("sessionSignals capture plan, execution, and memory boundaries", () => {
    const ctx = makeEmptyStats();
    ctx.currentSessionId = "session-1";
    parseTextLogLine("2026-03-06 09:00:00.000 [info] agent/plan", ctx);
    parseTextLogLine(
      "2026-03-06 09:00:05.000 [info] ccreq:edit01.copilotmd | success | claude-sonnet-4.6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    parseTextLogLine("2026-03-06 09:00:15.000 [info] /compact summarize_context", ctx);
    assert.deepStrictEqual(
      ctx.sessionSignals.map((event) => event.signalType),
      ["plan-proposal", "chat-request", "memory-boundary"],
    );
    assert.strictEqual(ctx.sessionSignals[1]?.phase, "execution");
    // Bare "agent/plan" text lines have no model info — modelName remains empty.
    assert.strictEqual(ctx.sessionSignals[0]?.modelName, "");
  });

  test("plan-proposal signal from JSON agent/plan event carries model name", () => {
    const ctx = makeEmptyStats();
    ctx.currentSessionId = "session-json-plan";
    processJsonEntry({ event: "agent/plan", model: "claude-3.7-sonnet", timestamp: "2026-03-06T10:00:00.000Z" }, ctx);
    const planSignals = ctx.sessionSignals.filter((s) => s.signalType === "plan-proposal");
    assert.strictEqual(planSignals.length, 1);
    assert.strictEqual(planSignals[0]?.modelName, "claude-3.7-sonnet");
  });

  test("plan-proposal signal from JSON strategy/propose event carries model name", () => {
    const ctx = makeEmptyStats();
    ctx.currentSessionId = "session-json-strategy";
    processJsonEntry({ event: "strategy/propose", modelId: "o3-mini", timestamp: "2026-03-06T10:01:00.000Z" }, ctx);
    const planSignals = ctx.sessionSignals.filter((s) => s.signalType === "plan-proposal");
    assert.strictEqual(planSignals.length, 1);
    assert.strictEqual(planSignals[0]?.modelName, "o3-mini");
  });

  test("plan-proposal signal from text ccreq line containing agent/plan carries model name", () => {
    const ctx = makeEmptyStats();
    ctx.currentSessionId = "session-ccreq-plan";
    // A ccreq line where the intent text includes "agent/plan"
    parseTextLogLine(
      "2026-03-06 10:05:00.000 [info] ccreq:plan01.copilotmd | success | gpt-4o | 3000ms | [agent/plan]",
      ctx,
    );
    const planSignals = ctx.sessionSignals.filter((s) => s.signalType === "plan-proposal");
    assert.strictEqual(planSignals.length, 1);
    assert.strictEqual(planSignals[0]?.modelName, "gpt-4o");
  });

  test("search subagent intent is classified as research in sessionSignals", () => {
    const ctx = makeEmptyStats();
    ctx.currentSessionId = "session-2";
    parseTextLogLine(
      "2026-03-06 10:00:00.000 [info] ccreq:search01.copilotmd | success | gpt-5.4 | 1500ms | [tool/searchSubagentTool]",
      ctx,
    );
    assert.strictEqual(ctx.sessionSignals.length, 1);
    assert.strictEqual(ctx.sessionSignals[0]?.phase, "research");
    assert.strictEqual(ctx.sessionSignals[0]?.actor, "ai");
  });

  test("browser navigate lines are emitted as research session signals", () => {
    const ctx = makeEmptyStats();
    ctx.currentSessionId = "session-3";
    parseTextLogLine("2026-03-06 10:05:00.000 [info] browser_navigate https://example.com", ctx);
    assert.strictEqual(ctx.sessionSignals.length, 1);
    assert.strictEqual(ctx.sessionSignals[0]?.intent, "browser/navigate");
    assert.strictEqual(ctx.sessionSignals[0]?.phase, "research");
  });

  test("panel/unknown followed by non-agentic ccreq leaves executedPlanCount at 0", () => {
    const ctx = makeEmptyStats();
    parseTextLogLine(
      "2026-03-06 09:00:00.000 [info] ccreq:plan01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 3000ms | [panel/unknown]",
      ctx,
    );
    // A regular chat request — not an agentic execution
    parseTextLogLine(
      "2026-03-06 09:00:03.000 [info] ccreq:chat01.copilotmd | success | gpt-5-mini | 800ms | [copilotLanguageModelWrapper]",
      ctx,
    );
    assert.strictEqual(ctx.planCount, 1);
    assert.strictEqual(ctx.executedPlanCount, 0);
    assert.strictEqual(ctx.activePlanPending, true);
  });

  test("multiple plan/execute cycles accumulate correctly", () => {
    const ctx = makeEmptyStats();
    // Cycle 1
    parseTextLogLine(
      "2026-03-06 09:00:00.000 [info] ccreq:plan01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 3000ms | [panel/unknown]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-06 09:00:05.000 [info] ccreq:edit01.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    // Cycle 2
    parseTextLogLine(
      "2026-03-06 09:01:00.000 [info] ccreq:plan02.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 3000ms | [panel/unknown]",
      ctx,
    );
    parseTextLogLine(
      "2026-03-06 09:01:05.000 [info] ccreq:edit02.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 5000ms | [panel/editAgent]",
      ctx,
    );
    assert.strictEqual(ctx.planCount, 2);
    assert.strictEqual(ctx.executedPlanCount, 2);
    assert.strictEqual(ctx.activePlanPending, false);
  });
});

suite("detectCommandUsage", () => {
  test("returns /fix for exact slash command", () => {
    assert.strictEqual(detectCommandUsage("/fix"), "/fix");
  });

  test("returns /explain for exact slash command", () => {
    assert.strictEqual(detectCommandUsage("/explain"), "/explain");
  });

  test("returns @workspace for participant", () => {
    assert.strictEqual(detectCommandUsage("@workspace"), "@workspace");
  });

  test("returns command for prefix match with trailing text", () => {
    assert.strictEqual(detectCommandUsage("/fix the error"), "/fix");
  });

  test("returns empty string for unknown string", () => {
    assert.strictEqual(detectCommandUsage("some random text"), "");
  });

  test("returns empty string for empty input", () => {
    assert.strictEqual(detectCommandUsage(""), "");
  });

  test("returns /tests for /tests command", () => {
    assert.strictEqual(detectCommandUsage("/tests"), "/tests");
  });

  test("case-insensitive match for slash commands", () => {
    assert.strictEqual(detectCommandUsage("/FIX"), "/fix");
  });
});
