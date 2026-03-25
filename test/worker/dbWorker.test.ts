import * as assert from "assert";
import type { SessionSignalEvent, TextChangeEvent, TrackedEvent } from "../../src/events/eventSchema";
import { buildSessionDetail, buildSessionList } from "../../src/worker/dbWorker";

function makeSignal(
  overrides: Partial<SessionSignalEvent> & Pick<SessionSignalEvent, "timestamp" | "signalType">,
): SessionSignalEvent {
  return {
    sessionId: "session-1",
    timestamp: overrides.timestamp,
    eventType: "sessionSignal",
    languageId: "typescript",
    signalType: overrides.signalType,
    actor: overrides.actor ?? "ai",
    phase: overrides.phase ?? "execution",
    intent: overrides.intent ?? "",
    rawText: overrides.rawText ?? overrides.signalType,
    modelName: overrides.modelName ?? "gpt-5.4",
    latencyMs: overrides.latencyMs ?? 0,
    success: overrides.success ?? true,
  };
}

function makeTextChange(timestamp: string, charsAdded: number): TextChangeEvent {
  return {
    sessionId: "session-1",
    timestamp,
    eventType: "textChange",
    languageId: "typescript",
    charsAdded,
    charsDeleted: 0,
  };
}

suite("dbWorker session detail", () => {
  test("buildSessionList keeps only sessions with matched chat titles", () => {
    const events: TrackedEvent[] = [
      {
        ...makeSignal({
          timestamp: "2026-03-08T09:00:00.000Z",
          signalType: "chat-request",
          actor: "human",
          phase: "human",
          intent: "vscodePrompt",
          rawText: "Implement session list title filtering",
        }),
        sessionId: "session-titled",
      },
      {
        ...makeSignal({
          timestamp: "2026-03-08T09:00:06.000Z",
          signalType: "chat-request",
          actor: "ai",
          phase: "execution",
          intent: "panel/editAgent",
        }),
        sessionId: "session-titled",
      },
      {
        ...makeTextChange("2026-03-08T09:00:08.000Z", 12),
        sessionId: "session-titled",
      },
      {
        ...makeSignal({
          timestamp: "2026-03-08T10:00:00.000Z",
          signalType: "chat-request",
          actor: "ai",
          phase: "execution",
          intent: "panel/editAgent",
          rawText: "background worker activity",
        }),
        sessionId: "session-untitled",
      },
      {
        ...makeTextChange("2026-03-08T10:00:03.000Z", 6),
        sessionId: "session-untitled",
      },
    ];

    const summaries = buildSessionList(
      events,
      [],
      [
        {
          chatSessionId: "chat-1",
          workspaceId: "workspace-1",
          title: "Implement session list title filtering",
          createdAt: "2026-03-08T09:00:01.000Z",
          lastMessageAt: "2026-03-08T09:05:00.000Z",
          firstRequestText: "Implement session list title filtering",
          requests: [
            {
              requestId: "request-1",
              timestamp: Date.parse("2026-03-08T09:00:01.000Z"),
              agentId: "github.copilot.editsAgent",
              customAgentName: null,
              modelId: "gpt-5.4",
              messageText: "Implement session list title filtering",
              timings: { firstProgress: 100, totalElapsed: 800 },
              toolCalls: [],
              availableSkills: [],
              loadedSkills: [],
            },
          ],
          source: "jsonl",
          provider: "copilot",
        },
      ],
    );

    assert.deepStrictEqual(
      summaries.map((summary) => ({ sessionId: summary.sessionId, title: summary.title })),
      [
        { sessionId: "session-titled", title: "Implement session list title filtering" },
        // session-untitled has no matched chat title, so it falls back to the event date
        { sessionId: "session-untitled", title: "2026-03-08" },
      ],
    );
  });

  test("buildSessionList falls back to event date when no selectable title is found", () => {
    const events: TrackedEvent[] = [
      {
        ...makeSignal({
          timestamp: "2026-03-08T11:00:00.000Z",
          signalType: "chat-request",
          actor: "human",
          phase: "human",
          intent: "vscodePrompt",
          rawText: "Title request only",
        }),
        sessionId: "session-empty-steps",
      },
      {
        ...makeTextChange("2026-03-08T11:00:03.000Z", 4),
        sessionId: "session-empty-steps",
      },
    ];

    const summaries = buildSessionList(
      events,
      [],
      [
        {
          chatSessionId: "chat-2",
          workspaceId: "workspace-1",
          title: "Title request only",
          createdAt: "2026-03-08T11:00:00.000Z",
          lastMessageAt: "2026-03-08T11:01:00.000Z",
          firstRequestText: "Title request only",
          requests: [],
          source: "jsonl",
          provider: "copilot",
        },
      ],
    );

    // After the fallback-title fix, sessions with actionable events but no chatSession
    // steps now appear with a date-based title rather than being dropped.
    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0]?.sessionId, "session-empty-steps");
    assert.strictEqual(summaries[0]?.title, "2026-03-08");
  });

  test("keeps post-loop human confirmation inside the same episode", () => {
    const events: TrackedEvent[] = [
      makeSignal({ timestamp: "2026-03-08T10:00:00.000Z", signalType: "plan-proposal", phase: "planning" }),
      makeSignal({
        timestamp: "2026-03-08T10:00:10.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "tool/runSubagent",
      }),
      makeSignal({
        timestamp: "2026-03-08T10:00:40.000Z",
        signalType: "tool-loop-stop",
        actor: "system",
        phase: "execution",
        modelName: "",
      }),
      makeTextChange("2026-03-08T10:01:00.000Z", 18),
      makeSignal({ timestamp: "2026-03-08T10:02:00.000Z", signalType: "plan-proposal", phase: "planning" }),
      makeSignal({
        timestamp: "2026-03-08T10:02:10.000Z",
        signalType: "chat-request",
        phase: "research",
        intent: "tool/searchSubagentTool",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.episodes.length, 2);
    assert.strictEqual(detail?.episodes[0]?.accepted, true);
    assert.strictEqual(detail?.episodes[0]?.humanActionCount, 1);
    assert.strictEqual(detail?.episodes[0]?.summary, "Human confirmed the episode outcome");

    const firstEpisodeId = detail?.episodes[0]?.episodeId;
    const loopStopEntry = detail?.timeline.find((entry) => entry.label === "Autonomous loop completed");
    const textChangeEntry = detail?.timeline.find((entry) => entry.label === "Text change");
    assert.strictEqual(loopStopEntry?.episodeId, firstEpisodeId);
    assert.strictEqual(textChangeEntry?.episodeId, firstEpisodeId);
    assert.strictEqual(detail?.threads.length, 1);
    assert.strictEqual(detail?.threads[0]?.hasAutonomousRun, true);
    assert.strictEqual(detail?.threads[0]?.acceptedChars, 18);
    assert.strictEqual(detail?.threads[0]?.stepCount, 4);
    assert.deepStrictEqual(
      (detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? []).map((step) => step.label),
      ["Considered", "Thought", "Considered", "Searched"],
    );
  });

  test("flags fatigue when degraded research-to-execution flow ends in a refresh boundary", () => {
    const events: TrackedEvent[] = [
      makeSignal({ timestamp: "2026-03-08T11:00:00.000Z", signalType: "plan-proposal", phase: "planning" }),
      makeSignal({
        timestamp: "2026-03-08T11:00:10.000Z",
        signalType: "chat-request",
        phase: "research",
        intent: "tool/searchSubagentTool",
      }),
      makeSignal({
        timestamp: "2026-03-08T11:00:20.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "tool/runSubagent",
      }),
      makeSignal({
        timestamp: "2026-03-08T11:00:30.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "apply_patch",
      }),
      makeSignal({
        timestamp: "2026-03-08T11:00:40.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "workspace/editfile",
      }),
      makeSignal({
        timestamp: "2026-03-08T11:00:50.000Z",
        signalType: "completion-shown",
        phase: "execution",
      }),
      makeSignal({
        timestamp: "2026-03-08T11:00:55.000Z",
        signalType: "completion-shown",
        phase: "execution",
      }),
      makeSignal({
        timestamp: "2026-03-08T11:01:00.000Z",
        signalType: "memory-boundary",
        actor: "system",
        phase: "memory",
        intent: "/compact",
        modelName: "",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.episodes.length, 1);
    assert.ok(detail?.fatigueMarker);
    assert.strictEqual(detail?.fatigueMarker?.episodeId, detail?.episodes[0]?.episodeId);
    assert.ok((detail?.fatigueMarker?.score ?? 0) >= 3);
    assert.match(detail?.fatigueMarker?.reason ?? "", /refresh boundary occurred/);
    assert.strictEqual(detail?.threads[0]?.hasAutonomousRun, true);
    assert.ok((detail?.threads[0]?.estimatedMinutesSaved ?? 0) > 0);
  });

  test("starts a new thread when vscodePrompt appears inside the same session", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T12:00:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:00:08.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "tool/runSubagent",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:00:20.000Z",
        signalType: "tool-loop-stop",
        actor: "system",
        phase: "execution",
        modelName: "",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:03:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:03:10.000Z",
        signalType: "chat-request",
        phase: "research",
        intent: "tool/searchSubagentTool",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.threads.length, 2);
    assert.strictEqual(detail?.threads[0]?.title.startsWith("New Chat"), true);
    assert.strictEqual(detail?.threads[1]?.title.startsWith("New Chat"), true);
    assert.strictEqual(detail?.threads[0]?.hasSelectableTitle, false);
    assert.strictEqual(detail?.threads[1]?.hasSelectableTitle, false);
    const firstThreadSteps = detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    const secondThreadSteps = detail?.stepsByThread[detail?.threads[1]?.threadId ?? ""] ?? [];
    assert.deepStrictEqual(
      firstThreadSteps.map((step) => step.label),
      ["Prompt", "Thought"],
    );
    assert.deepStrictEqual(
      secondThreadSteps.map((step) => step.label),
      ["Prompt", "Searched"],
    );
  });

  test("prefers extracted thread title signals over fallback labels", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T12:00:00.000Z",
        signalType: "thread-title",
        actor: "system",
        phase: "planning",
        intent: "thread-title",
        rawText: "Investigate flaky auth refresh",
        modelName: "",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:00:01.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
        rawText: "How do we fix the flaky auth refresh flow?",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:00:08.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "tool/runSubagent",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.threads[0]?.title, "Investigate flaky auth refresh");
    assert.strictEqual(detail?.threads[0]?.hasSelectableTitle, true);
    const firstThreadSteps = detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    assert.deepStrictEqual(
      firstThreadSteps.map((step) => step.label),
      ["Prompt", "Thought"],
    );
  });

  test("falls back to the first human prompt raw text when no extracted title exists", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T12:03:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
        rawText: "Implement OAuth callback handling for mobile deep links",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:03:10.000Z",
        signalType: "chat-request",
        phase: "research",
        intent: "tool/searchSubagentTool",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.threads[0]?.title, "Implement OAuth callback handling for mobile deep links");
    assert.strictEqual(detail?.threads[0]?.hasSelectableTitle, true);
    assert.deepStrictEqual(
      (detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? []).map((step) => step.label),
      ["Prompt", "Searched"],
    );
  });

  test("builds a real-log-aware fallback title when a title intent exists without title text", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T12:11:33.232Z",
        signalType: "chat-request",
        actor: "system",
        phase: "planning",
        intent: "title",
        rawText:
          "2026-03-08 12:11:33.232 [info] ccreq:d670e6af.copilotmd | success | gpt-4o-mini-2024-07-18 | 736ms | [title]",
        modelName: "gpt-4o-mini-2024-07-18",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:11:36.918Z",
        signalType: "chat-request",
        actor: "ai",
        phase: "execution",
        intent: "panel/editAgent",
        rawText:
          "2026-03-08 12:11:36.918 [info] ccreq:b88dfa56.copilotmd | success | gpt-5.4 -> gpt-5.4-2026-03-05 | 4322ms | [panel/editAgent]",
        modelName: "gpt-5.4",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:11:41.424Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "copilotLanguageModelWrapper",
        rawText:
          "2026-03-08 12:11:41.424 [info] ccreq:05fc8bf5.copilotmd | success | gpt-4o-mini -> gpt-4o-mini-2024-07-18 | 582ms | [copilotLanguageModelWrapper]",
        modelName: "gpt-4o-mini",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.threads.length, 1);
    assert.match(detail?.threads[0]?.title ?? "", /^Editing session · /);
    assert.strictEqual(detail?.threads[0]?.hasSelectableTitle, false);
  });

  test("matches workspace chat customTitle to the nearest thread start", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T12:11:36.918Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
        rawText: "Text change",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:11:40.000Z",
        signalType: "chat-request",
        actor: "ai",
        phase: "execution",
        intent: "panel/editAgent",
      }),
    ];

    const detail = buildSessionDetail("session-1", events, [
      {
        chatSessionId: "chat-1",
        workspaceId: "workspace-1",
        title: "コンテキスト疲労度分析機能の実装",
        createdAt: "2026-03-08T12:11:35.000Z",
        lastMessageAt: "2026-03-08T12:20:00.000Z",
        firstRequestText: null,
      },
    ]);

    assert.ok(detail);
    assert.strictEqual(detail?.threads[0]?.title, "コンテキスト疲労度分析機能の実装");
    assert.strictEqual(detail?.threads[0]?.hasSelectableTitle, true);
  });

  test("ignores workspace chat titles that are too far from the thread start", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T12:03:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
        rawText: "Implement OAuth callback handling for mobile deep links",
      }),
      makeSignal({
        timestamp: "2026-03-08T12:03:10.000Z",
        signalType: "chat-request",
        phase: "research",
        intent: "tool/searchSubagentTool",
      }),
    ];

    const detail = buildSessionDetail("session-1", events, [
      {
        chatSessionId: "chat-2",
        workspaceId: "workspace-1",
        title: "自律性進化トレンドの可視化実装",
        createdAt: "2026-03-08T14:30:00.000Z",
        lastMessageAt: "2026-03-08T14:40:00.000Z",
        firstRequestText: null,
      },
    ]);

    assert.ok(detail);
    assert.strictEqual(detail?.threads[0]?.title, "Implement OAuth callback handling for mobile deep links");
  });

  test("starts a new thread after a ten minute inactivity gap", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T13:00:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
      }),
      makeTextChange("2026-03-08T13:00:15.000Z", 24),
      makeSignal({
        timestamp: "2026-03-08T13:11:00.000Z",
        signalType: "chat-request",
        phase: "execution",
        intent: "apply_patch",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    assert.strictEqual(detail?.threads.length, 2);
    assert.strictEqual(detail?.threads[0]?.acceptedChars, 24);
    assert.strictEqual(detail?.threads[1]?.title.includes("Patch thread"), true);
    assert.strictEqual(detail?.threads[1]?.hasSelectableTitle, false);
    assert.strictEqual(detail?.threads[1]?.stepCount, 1);
    assert.strictEqual(detail?.stepsByThread[detail?.threads[1]?.threadId ?? ""]?.[0]?.label, "Updated");
    assert.strictEqual(detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""]?.[0]?.label, "Prompt");
  });

  test("emits explicit executed, reference, and memory steps in chronological order", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T14:00:00.000Z",
        signalType: "reference-used",
        actor: "system",
        phase: "research",
        intent: "context/file",
        rawText: "src/worker/dbWorker.ts",
        modelName: "",
      }),
      makeSignal({
        timestamp: "2026-03-08T14:00:02.000Z",
        signalType: "command-executed",
        phase: "execution",
        intent: "terminal/runCommand",
        rawText: "rg -n AgentStep src",
      }),
      makeSignal({
        timestamp: "2026-03-08T14:00:07.000Z",
        signalType: "memory-boundary",
        actor: "system",
        phase: "memory",
        intent: "/compact",
        modelName: "",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    const steps = detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    assert.deepStrictEqual(
      steps.map((step) => step.label),
      ["Used reference", "Executed", "Memory file"],
    );
    assert.strictEqual(steps[0]?.durationMs, 2000);
    assert.strictEqual(steps[1]?.durationMs, 5000);
    assert.strictEqual(detail?.threads[0]?.longestPauseMs, 5000);
  });

  test("keeps generic ai actions as Thought instead of dropping the thread to zero steps", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T15:00:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
        rawText: "Explain the implementation plan",
      }),
      makeSignal({
        timestamp: "2026-03-08T15:00:04.000Z",
        signalType: "chat-request",
        actor: "ai",
        phase: "execution",
        intent: "panel/editAgent",
        rawText: "panel/editAgent",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    const steps = detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    assert.deepStrictEqual(
      steps.map((step) => step.label),
      ["Prompt", "Thought"],
    );
    assert.strictEqual(steps[1]?.isFallback, true);
  });

  test("marks a significant pause when visible steps are more than ten minutes apart inside one thread", () => {
    const events: TrackedEvent[] = [
      makeSignal({
        timestamp: "2026-03-08T16:00:00.000Z",
        signalType: "chat-request",
        actor: "human",
        phase: "human",
        intent: "vscodePrompt",
        rawText: "Investigate timeline pauses",
      }),
      makeSignal({
        timestamp: "2026-03-08T16:06:00.000Z",
        signalType: "completion-shown",
        actor: "ai",
        phase: "execution",
        intent: "suggestion",
        rawText: "suggestion shown",
      }),
      makeSignal({
        timestamp: "2026-03-08T16:12:00.000Z",
        signalType: "chat-request",
        actor: "ai",
        phase: "research",
        intent: "tool/searchSubagentTool",
        rawText: "search logs for session signals",
      }),
    ];

    const detail = buildSessionDetail("session-1", events);
    assert.ok(detail);
    const steps = detail?.stepsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    assert.deepStrictEqual(
      steps.map((step) => step.label),
      ["Prompt", "Searched"],
    );
    assert.strictEqual(steps[0]?.durationMs, 12 * 60_000);
    assert.strictEqual(steps[0]?.isSignificantPause, true);
    assert.strictEqual(detail?.threads[0]?.longestPauseMs, 12 * 60_000);
  });
});
