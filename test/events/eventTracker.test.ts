import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "fs";
import type { SessionSignalEvent, TrackedEvent } from "../../src/events/eventSchema";
import { EventTracker } from "../../src/events/eventTracker";
import type { DbWorkerClient } from "../../src/worker/dbWorkerClient";

/** Remove a directory tree (cleanup). */
function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/** Build a mock DbWorkerClient that records `ingest` and `compact` calls. */
function makeMockWorker(opts?: {
  failOnce?: boolean;
}): DbWorkerClient & { calls: TrackedEvent[][]; compactCalls: number } {
  let failNext = opts?.failOnce ?? false;
  const calls: TrackedEvent[][] = [];
  let compactCalls = 0;
  return {
    calls,
    get compactCalls() {
      return compactCalls;
    },
    loadFromJsonl: async () => ({ loaded: 0 }),
    ingest: async (events: TrackedEvent[]) => {
      if (failNext) {
        failNext = false;
        throw new Error("worker busy");
      }
      calls.push(events.slice());
      return { ingested: events.length, total: events.length };
    },
    query: async () => [],
    compact: async () => {
      compactCalls++;
      return { compacted: 0 };
    },
    close: async () => {},
  } as unknown as DbWorkerClient & { calls: TrackedEvent[][]; compactCalls: number };
}

/** Build a minimal fake ExtensionContext. */
function makeContext(storagePath: string): vscode.ExtensionContext {
  return {
    subscriptions: [],
    globalStorageUri: vscode.Uri.file(storagePath),
    logUri: vscode.Uri.file("/tmp/logs/session-abc123"),
  } as unknown as vscode.ExtensionContext;
}

suite("EventTracker", () => {
  let tracker: EventTracker;
  const storagePath = "/tmp/event-tracker-test-storage";

  setup(() => {
    rmrf(storagePath);
    tracker = new EventTracker(makeContext(storagePath));
  });

  teardown(() => {
    tracker.dispose();
    rmrf(storagePath);
  });

  test("storage is accessible after construction", () => {
    assert.ok(tracker.storage);
  });

  test("recordSessionSignal writes a completion-shown event", async () => {
    await tracker.recordSessionSignal({
      languageId: "typescript",
      signalType: "completion-shown",
      actor: "system",
      phase: "planning",
      intent: "inline-completion/shown",
      rawText: "inline completion shown",
    });
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    const last = events[events.length - 1] as SessionSignalEvent;
    assert.strictEqual(last.eventType, "sessionSignal");
    assert.strictEqual(last.signalType, "completion-shown");
    assert.strictEqual(last.languageId, "typescript");
    assert.strictEqual(last.success, true);
  });

  test("dispose is idempotent", () => {
    tracker.dispose();
    assert.doesNotThrow(() => tracker.dispose());
  });

  test("sessionId is derived from logUri", async () => {
    await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    const last = events[events.length - 1];
    assert.strictEqual(last.sessionId, "session-abc123");
  });

});

suite("EventTracker — batching", () => {
  const storagePath = "/tmp/event-tracker-batch-test-storage";

  teardown(() => {
    rmrf(storagePath);
  });

  test("bufferSize starts at 0 without a worker", () => {
    const tracker = new EventTracker(makeContext(storagePath));
    assert.strictEqual(tracker.bufferSize, 0);
    tracker.dispose();
  });

  test("events are buffered and not immediately sent to worker", async () => {
    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    // Adding 9 events should NOT trigger a flush (threshold is 10).
    for (let i = 0; i < 9; i++) {
      await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    }

    assert.strictEqual(worker.calls.length, 0, "no flush before batch size is reached");
    assert.strictEqual(tracker.bufferSize, 9);
    tracker.dispose();
  });

  test("flush triggers when buffer reaches BATCH_SIZE (10)", async () => {
    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    for (let i = 0; i < 10; i++) {
      await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    }

    assert.strictEqual(worker.calls.length, 1, "exactly one ingest call after 10 events");
    assert.strictEqual(worker.calls[0].length, 10);
    assert.strictEqual(tracker.bufferSize, 0, "buffer cleared after successful flush");
    tracker.dispose();
  });

  test("buffer is retained on worker error (retry on next flush)", async () => {
    const worker = makeMockWorker({ failOnce: true });
    const tracker = new EventTracker(makeContext(storagePath), worker);

    // Add 10 events — triggers a flush that will fail.
    for (let i = 0; i < 10; i++) {
      await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    }

    // Worker call failed: buffer must still contain the 10 events.
    assert.strictEqual(worker.calls.length, 0, "failed ingest must not count as success");
    assert.strictEqual(tracker.bufferSize, 10, "events retained after worker error");

    // Add one more event and trigger a second batch flush (now 11 events ≥ 10).
    await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });

    // Worker is healthy now — should have flushed all 11.
    assert.strictEqual(worker.calls.length, 1);
    assert.strictEqual(worker.calls[0].length, 11);
    assert.strictEqual(tracker.bufferSize, 0);
    tracker.dispose();
  });

  test("dispose flushes remaining buffered events", async () => {
    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    // Add fewer than BATCH_SIZE events so no automatic flush occurs.
    for (let i = 0; i < 5; i++) {
      await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    }
    assert.strictEqual(worker.calls.length, 0, "no flush yet");

    // dispose() must trigger a flush.
    tracker.dispose();
    // Give the async flush a chance to complete; the mock resolves immediately
    // so 100ms provides a generous margin even on slow CI machines.
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(worker.calls.length, 1, "flush called on dispose");
    assert.strictEqual(worker.calls[0].length, 5);
  });

  test("no timer is started when no worker is provided", () => {
    // We verify indirectly: the tracker must construct and dispose without errors,
    // and bufferSize must remain 0 regardless of events (no worker to buffer for).
    const tracker = new EventTracker(makeContext(storagePath));
    assert.strictEqual(tracker.bufferSize, 0);
    tracker.dispose();
  });

  test("compact timer is cleared on dispose without errors", () => {
    // Verifies that the compaction timer is registered and cleaned up on dispose.
    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);
    // dispose() must not throw and must be idempotent even with a compact timer.
    assert.doesNotThrow(() => tracker.dispose());
    assert.doesNotThrow(() => tracker.dispose());
  });
});

suite("EventTracker — enableAdvancedAnalysis toggle", () => {
  const storagePath = "/tmp/event-tracker-toggle-test-storage";

  setup(() => {
    rmrf(storagePath);
  });

  teardown(async () => {
    // Restore the default setting after each test.
    await vscode.workspace
      .getConfiguration("copilot-insight")
      .update("enableAdvancedAnalysis", undefined, vscode.ConfigurationTarget.Global);
    rmrf(storagePath);
  });

  test("worker ingest is skipped when enableAdvancedAnalysis is false", async () => {
    // Disable advanced analysis.
    await vscode.workspace
      .getConfiguration("copilot-insight")
      .update("enableAdvancedAnalysis", false, vscode.ConfigurationTarget.Global);

    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    // Even with 10+ events, the worker must never receive them.
    for (let i = 0; i < 10; i++) {
      await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    }

    assert.strictEqual(worker.calls.length, 0, "worker must not be called when analysis is disabled");
    assert.strictEqual(tracker.bufferSize, 0, "buffer must not accumulate when analysis is disabled");
    tracker.dispose();
  });

  test("JSONL storage always receives events even when analysis is disabled", async () => {
    // Disable advanced analysis.
    await vscode.workspace
      .getConfiguration("copilot-insight")
      .update("enableAdvancedAnalysis", false, vscode.ConfigurationTarget.Global);

    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });

    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    assert.ok(events.length >= 1, "JSONL storage must always record events");
    tracker.dispose();
  });

  test("worker ingest runs normally when enableAdvancedAnalysis is true (default)", async () => {
    // Explicitly set to true (same as default) to confirm normal behavior.
    await vscode.workspace
      .getConfiguration("copilot-insight")
      .update("enableAdvancedAnalysis", true, vscode.ConfigurationTarget.Global);

    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    for (let i = 0; i < 10; i++) {
      await tracker.recordSessionSignal({ signalType: "chat-request", actor: "human", phase: "human", intent: "vscodePrompt", rawText: "test" });
    }

    assert.strictEqual(worker.calls.length, 1, "worker must be called when analysis is enabled");
    assert.strictEqual(worker.calls[0].length, 10);
    tracker.dispose();
  });
});
