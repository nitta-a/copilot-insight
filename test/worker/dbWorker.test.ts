import * as assert from "assert";
import type { SessionSignalEvent, TextChangeEvent, TrackedEvent } from "../../src/events/eventSchema";
import { buildSessionDetail } from "../../src/worker/dbWorker";

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
    const firstThreadActions = detail?.eventsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    assert.strictEqual(firstThreadActions.length, 2);
    assert.strictEqual(firstThreadActions[0]?.children.length, 1);
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
    const firstThreadActions = detail?.eventsByThread[detail?.threads[0]?.threadId ?? ""] ?? [];
    assert.strictEqual(firstThreadActions.length, 1);
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
    assert.match(detail?.threads[0]?.title ?? "", /^Execution thread · /);
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
  });
});
