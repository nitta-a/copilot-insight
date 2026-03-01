import * as assert from "assert";
import {
  incrementStatCount,
  normalizeContextSource,
  parseLogContent,
  parseTextLogLine,
  processJsonEntry,
  tryParseJsonLogLine,
} from "../../log/logContentParser";
import type { ParsingContext } from "../../types";

function makeEmptyStats(): ParsingContext {
  return {
    totalShown: 0,
    totalAccepted: 0,
    totalRejected: 0,
    totalChat: 0,
    acceptanceRate: 0,
    avgLatencyMs: 0,
    byLanguage: new Map(),
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
    latencySum: 0,
    latencyCount: 0,
    chatLatencySum: 0,
    chatLatencyCount: 0,
    currentSessionId: "",
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
      assert.deepStrictEqual(stats.byLanguage.get("rust"), {
        shown: 1,
        accepted: 0,
      });
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
      assert.deepStrictEqual(stats.byLanguage.get("typescript"), {
        shown: 1,
        accepted: 0,
      });
    });

    test("extracts language from 'lang: X' pattern", () => {
      const stats = makeEmptyStats();
      parseTextLogLine("2024-01-15 suggestion shown lang: Python", stats);
      assert.deepStrictEqual(stats.byLanguage.get("python"), {
        shown: 1,
        accepted: 0,
      });
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
      assert.deepStrictEqual(stats.byLanguage.get("go"), {
        shown: 1,
        accepted: 0,
      });
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

    test("returns empty string for unknown types", () => {
      assert.strictEqual(normalizeContextSource("unknown"), "");
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

    test("ignores unknown context types", () => {
      const stats = makeEmptyStats();
      processJsonEntry({ event: "shown", contextItems: [{ type: "unknown_source" }] }, stats);
      assert.strictEqual(stats.byContextSource.size, 0);
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
});
