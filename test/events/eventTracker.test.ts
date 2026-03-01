import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import { EventTracker } from "../../src/events/eventTracker";
import type { DbWorkerClient } from "../../src/worker/dbWorkerClient";
import type { TrackedEvent } from "../../src/events/eventSchema";

/** Remove a directory tree (cleanup). */
function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/** Build a mock DbWorkerClient that records `ingest` calls. */
function makeMockWorker(opts?: { failOnce?: boolean }): DbWorkerClient & { calls: TrackedEvent[][] } {
  let failNext = opts?.failOnce ?? false;
  const calls: TrackedEvent[][] = [];
  return {
    calls,
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
    trueRate: async () => ({ rate: 0, windowMs: 0, acceptedCount: 0 }),
    velocity: async () => ({ kpm: 0, windowMs: 0, sampleCount: 0 }),
    modelPerformance: async () => ({ crossTab: [], bestModelByLanguage: new Map() }),
    close: async () => {},
  } as unknown as DbWorkerClient & { calls: TrackedEvent[][] };
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

  test("recordCompletionAccept writes an event", async () => {
    await tracker.recordCompletionAccept({
      languageId: "typescript",
      acceptedText: "console.log('hello');",
      modelName: "gpt-4o",
      latencyMs: 250,
      isPartialAccept: false,
    });
    // Verify the event was written by reading today's date file
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    assert.ok(events.length >= 1);
    const last = events[events.length - 1];
    assert.strictEqual(last.eventType, "completionAccept");
    if (last.eventType === "completionAccept") {
      assert.strictEqual(last.languageId, "typescript");
      assert.strictEqual(last.modelName, "gpt-4o");
      assert.strictEqual(last.latencyMs, 250);
      assert.strictEqual(last.isPartialAccept, false);
      assert.strictEqual(last.acceptedCharacters, 21);
      assert.ok(Array.isArray(last.openEditorPaths));
    }
  });

  test("recordCompletionAccept uses defaults for optional fields", async () => {
    await tracker.recordCompletionAccept({
      languageId: "python",
      acceptedText: "pass",
    });
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    const last = events[events.length - 1];
    assert.strictEqual(last.eventType, "completionAccept");
    if (last.eventType === "completionAccept") {
      assert.strictEqual(last.modelName, "");
      assert.strictEqual(last.latencyMs, 0);
      assert.strictEqual(last.isPartialAccept, false);
    }
  });

  test("recordCompletionAccept with partial accept flag", async () => {
    await tracker.recordCompletionAccept({
      languageId: "go",
      acceptedText: "fmt.Println",
      isPartialAccept: true,
    });
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    const last = events[events.length - 1];
    if (last.eventType === "completionAccept") {
      assert.strictEqual(last.isPartialAccept, true);
      assert.strictEqual(last.acceptedCharacters, 11);
    }
  });

  test("dispose is idempotent", () => {
    tracker.dispose();
    assert.doesNotThrow(() => tracker.dispose());
  });

  test("sessionId is derived from logUri", async () => {
    await tracker.recordCompletionAccept({
      languageId: "rust",
      acceptedText: "let x = 1;",
    });
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    const last = events[events.length - 1];
    assert.strictEqual(last.sessionId, "session-abc123");
  });

  // ---------------------------------------------------------------------------
  // Sliding-window active-completion map
  // ---------------------------------------------------------------------------

  test("trackActiveCompletion stores a completion at the given URI and line", () => {
    tracker.trackActiveCompletion("file:///test.ts", 10, "typescript");
    const result = tracker.lookupActiveCompletion("file:///test.ts", 10);
    assert.ok(result);
    assert.strictEqual(result.uri, "file:///test.ts");
    assert.strictEqual(result.lineNumber, 10);
    assert.strictEqual(result.languageId, "typescript");
  });

  test("lookupActiveCompletion returns undefined for unknown location", () => {
    assert.strictEqual(tracker.lookupActiveCompletion("file:///unknown.ts", 0), undefined);
  });

  test("trackActiveCompletion uses URI+line as composite key", () => {
    tracker.trackActiveCompletion("file:///a.ts", 5, "typescript");
    tracker.trackActiveCompletion("file:///b.ts", 5, "python"); // same line, different URI
    tracker.trackActiveCompletion("file:///a.ts", 6, "typescript"); // same URI, different line

    assert.ok(tracker.lookupActiveCompletion("file:///a.ts", 5));
    assert.ok(tracker.lookupActiveCompletion("file:///b.ts", 5));
    assert.ok(tracker.lookupActiveCompletion("file:///a.ts", 6));
    assert.strictEqual(tracker.lookupActiveCompletion("file:///a.ts", 7), undefined);
  });

  test("trackActiveCompletion overwrites a previous entry for the same key", () => {
    const t1 = Date.now() - 1000;
    const t2 = Date.now();
    tracker.trackActiveCompletion("file:///a.ts", 3, "typescript", t1);
    tracker.trackActiveCompletion("file:///a.ts", 3, "javascript", t2);
    const result = tracker.lookupActiveCompletion("file:///a.ts", 3);
    assert.ok(result);
    assert.strictEqual(result.languageId, "javascript");
    assert.strictEqual(result.acceptedAt, t2);
  });

  test("pruneActiveCompletions removes entries older than 5 minutes", () => {
    const fiveMinutesPlusOneMs = 5 * 60 * 1_000 + 1;
    const staleTime = Date.now() - fiveMinutesPlusOneMs;
    tracker.trackActiveCompletion("file:///test.ts", 1, "typescript", staleTime);
    tracker.trackActiveCompletion("file:///test.ts", 2, "typescript"); // fresh

    tracker.pruneActiveCompletions();

    assert.strictEqual(tracker.lookupActiveCompletion("file:///test.ts", 1), undefined);
    assert.ok(tracker.lookupActiveCompletion("file:///test.ts", 2));
  });

  test("pruneActiveCompletions with explicit nowMs removes entries in the window", () => {
    const t0 = Date.now();
    tracker.trackActiveCompletion("file:///test.ts", 1, "typescript", t0 - 1_000);
    tracker.trackActiveCompletion("file:///test.ts", 2, "typescript", t0 - 2_000);

    // Advance "now" by 6 minutes so both entries are beyond the 5-minute window.
    tracker.pruneActiveCompletions(t0 + 6 * 60 * 1_000);

    assert.strictEqual(tracker.lookupActiveCompletion("file:///test.ts", 1), undefined);
    assert.strictEqual(tracker.lookupActiveCompletion("file:///test.ts", 2), undefined);
  });

  test("pruneActiveCompletions keeps entries within the 5-minute window", () => {
    const t0 = Date.now();
    tracker.trackActiveCompletion("file:///test.ts", 1, "typescript", t0 - 4 * 60 * 1_000);

    tracker.pruneActiveCompletions(t0); // only 4 min old — should survive

    assert.ok(tracker.lookupActiveCompletion("file:///test.ts", 1));
  });

  test("trackActiveCompletion auto-prunes stale entries on insertion", () => {
    const staleTime = Date.now() - 6 * 60 * 1_000; // 6 minutes ago
    // Insert a stale entry by passing a past nowMs.
    tracker.trackActiveCompletion("file:///stale.ts", 0, "typescript", staleTime);

    // Insert a fresh entry with real time — this triggers pruneActiveCompletions.
    tracker.trackActiveCompletion("file:///fresh.ts", 0, "typescript");

    // The stale entry should have been pruned.
    assert.strictEqual(tracker.lookupActiveCompletion("file:///stale.ts", 0), undefined);
    assert.ok(tracker.lookupActiveCompletion("file:///fresh.ts", 0));
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
      await tracker.recordCompletionAccept({ languageId: "typescript", acceptedText: "x" });
    }

    assert.strictEqual(worker.calls.length, 0, "no flush before batch size is reached");
    assert.strictEqual(tracker.bufferSize, 9);
    tracker.dispose();
  });

  test("flush triggers when buffer reaches BATCH_SIZE (10)", async () => {
    const worker = makeMockWorker();
    const tracker = new EventTracker(makeContext(storagePath), worker);

    for (let i = 0; i < 10; i++) {
      await tracker.recordCompletionAccept({ languageId: "typescript", acceptedText: "x" });
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
      await tracker.recordCompletionAccept({ languageId: "typescript", acceptedText: "x" });
    }

    // Worker call failed: buffer must still contain the 10 events.
    assert.strictEqual(worker.calls.length, 0, "failed ingest must not count as success");
    assert.strictEqual(tracker.bufferSize, 10, "events retained after worker error");

    // Add one more event and trigger a second batch flush (now 11 events ≥ 10).
    await tracker.recordCompletionAccept({ languageId: "typescript", acceptedText: "y" });

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
      await tracker.recordCompletionAccept({ languageId: "rust", acceptedText: "fn" });
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
      await tracker.recordCompletionAccept({ languageId: "typescript", acceptedText: "x" });
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

    await tracker.recordCompletionAccept({ languageId: "python", acceptedText: "pass" });

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
      await tracker.recordCompletionAccept({ languageId: "typescript", acceptedText: "x" });
    }

    assert.strictEqual(worker.calls.length, 1, "worker must be called when analysis is enabled");
    assert.strictEqual(worker.calls[0].length, 10);
    tracker.dispose();
  });
});
