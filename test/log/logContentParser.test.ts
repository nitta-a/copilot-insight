import * as assert from "assert";
import {
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
    byContextEffectiveness: new Map(),
  };
}

suite("logContentParser", () => {
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
  });

  suite("parseTextLogLine", () => {
    test("increments totalShown for 'suggestion shown'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-01-15 suggestion shown language: typescript", stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("increments totalShown for 'completion shown'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("completion shown", stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("increments totalShown for 'shown suggestion'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("shown suggestion", stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("increments totalAccepted for 'suggestion accepted'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("suggestion accepted lang: python", stats);
      assert.strictEqual(stats.totalAccepted, 1);
    });

    test("increments totalAccepted for 'completion accepted'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("completion accepted", stats);
      assert.strictEqual(stats.totalAccepted, 1);
    });

    test("increments totalAccepted for 'accepted suggestion'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("accepted suggestion", stats);
      assert.strictEqual(stats.totalAccepted, 1);
    });

    test("increments totalRejected for 'suggestion rejected'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("suggestion rejected", stats);
      assert.strictEqual(stats.totalRejected, 1);
    });

    test("increments totalRejected for 'dismissed'", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("dismissed", stats);
      assert.strictEqual(stats.totalRejected, 1);
    });

    test("extracts language from 'language: X' pattern", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-01-15 suggestion shown language: TypeScript", stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("extracts language from 'lang: X' pattern", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-01-15 suggestion shown lang: Python", stats);
      assert.strictEqual(stats.totalShown, 1);
    });

    test("extracts date from log line", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-03-20 suggestion shown", stats);
      assert.deepStrictEqual(stats.byDate.get("2024-03-20"), {
        shown: 1,
        accepted: 0,
      });
    });

    test("does nothing for unrecognized lines", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("some unrelated log line", stats);
      assert.strictEqual(stats.totalShown, 0);
      assert.strictEqual(stats.totalAccepted, 0);
      assert.strictEqual(stats.totalRejected, 0);
    });
  });

  suite("parseLogContent", () => {
    test("skips empty lines", () => {
      const stats = makeEmptyStats();
      parseLogContent("\n\n\n", stats);
      assert.strictEqual(stats.totalShown, 0);
    });

    test("parses multiple lines", () => {
      const stats = makeEmptyStats();
      const content = [
        `${JSON.stringify({ event: "suggestion_shown", language: "typescript", timestamp: "2024-01-15T10:00:00Z" })}`,
        `${JSON.stringify({ event: "suggestion_accepted", language: "typescript", timestamp: "2024-01-15T10:01:00Z" })}`,
        "suggestion rejected",
      ].join("\n");
      parseLogContent(content, stats);
      assert.strictEqual(stats.totalShown, 1);
      assert.strictEqual(stats.totalAccepted, 1);
      assert.strictEqual(stats.totalRejected, 1);
    });

    test("parses JSON lines preferentially over text parsing", () => {
      const stats = makeEmptyStats();
      // A line that contains JSON and also text that could be matched as text
      const line = `suggestion shown ${JSON.stringify({ event: "suggestion_accepted" })}`;
      parseLogContent(line, stats);
      // Should be parsed as JSON (accepted), not text (shown)
      assert.strictEqual(stats.totalAccepted, 1);
      assert.strictEqual(stats.totalShown, 0);
    });

    test("falls back to text parsing when JSON is invalid", () => {
      const stats = makeEmptyStats();
      parseLogContent("suggestion shown language: go", stats);
      assert.strictEqual(stats.totalShown, 1);
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

    test("ccreq with XtabProvider tracks model in byModel (inline), not byChatModel", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 ccreq:mno345 | success | gpt-4o | 120ms | [XtabProvider]", stats);
      assert.strictEqual(stats.totalChat, 0);
      assert.strictEqual(stats.totalAccepted, 1);
      assert.deepStrictEqual(stats.byModel.get("gpt-4o"), { shown: 0, accepted: 1 });
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
      parseTextLogLine("2024-06-01 ccreq:def | success | gpt-4o | 800ms | [vscodePrompt]", stats);
      const session = stats.bySession.get("session-001");
      assert.ok(session);
      assert.strictEqual(session.shown, 1);
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

    test("unrelated context line not recorded", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 some unrelated log context", stats);
      assert.strictEqual(stats.byContextSource.size, 0);
    });

    test("accumulates multiple context source mentions", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-06-01 [ContextProvider] added openTab: a.ts", stats);
      parseTextLogLine("2024-06-01 [ContextProvider] added openTab: b.ts", stats);
      parseTextLogLine("2024-06-01 [ContextProvider] workspace context loaded", stats);
      assert.strictEqual(stats.byContextSource.get("Open Tabs"), 2);
      assert.strictEqual(stats.byContextSource.get("Workspace"), 1);
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

    test("parseLogContent processes subagent lines across content", () => {
      const stats = makeEmptyStats();
      const content = [
        "2024-06-01 10:00:00.000 ccreq:a | success | gpt-4o | 1000ms | [tool/runSubagent]",
        "2024-06-01 10:00:05.000 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false",
      ].join("\n");
      parseLogContent(content, stats);
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
