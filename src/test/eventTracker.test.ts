import * as assert from "assert";
import * as vscode from "vscode";
import { EventTracker } from "../eventTracker";

suite("EventTracker", () => {
  let tracker: EventTracker;

  setup(() => {
    const subscriptions: vscode.Disposable[] = [];
    const context = {
      subscriptions,
      globalStorageUri: vscode.Uri.file("/tmp/event-tracker-test-storage"),
      logUri: vscode.Uri.file("/tmp/logs/session-abc123"),
    } as unknown as vscode.ExtensionContext;
    tracker = new EventTracker(context);
  });

  teardown(() => {
    tracker.dispose();
  });

  test("storage is accessible after construction", () => {
    assert.ok(tracker.storage);
  });

  test("recordCompletionAccept writes an event", () => {
    tracker.recordCompletionAccept({
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

  test("recordCompletionAccept uses defaults for optional fields", () => {
    tracker.recordCompletionAccept({
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

  test("recordCompletionAccept with partial accept flag", () => {
    tracker.recordCompletionAccept({
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

  test("sessionId is derived from logUri", () => {
    tracker.recordCompletionAccept({
      languageId: "rust",
      acceptedText: "let x = 1;",
    });
    const today = new Date().toISOString().substring(0, 10);
    const events = tracker.storage.readByDate(today);
    const last = events[events.length - 1];
    assert.strictEqual(last.sessionId, "session-abc123");
  });
});
