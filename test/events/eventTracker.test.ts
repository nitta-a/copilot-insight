import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import { EventTracker } from "../../src/events/eventTracker";

/** Remove a directory tree (cleanup). */
function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

suite("EventTracker", () => {
  let tracker: EventTracker;
  const storagePath = "/tmp/event-tracker-test-storage";

  setup(() => {
    rmrf(storagePath);
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
      globalStorageUri: vscode.Uri.file(storagePath),
      logUri: vscode.Uri.file("/tmp/logs/session-abc123"),
    } as unknown as vscode.ExtensionContext;
    tracker = new EventTracker(context);
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
