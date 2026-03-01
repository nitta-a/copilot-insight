import * as assert from "assert";
import type {
  CompletionAcceptEvent,
  EditorSwitchEvent,
  TextChangeEvent,
  TrackedEvent,
} from "../../src/events/eventSchema";
import { calculateEfficiency } from "../../src/events/eventSchema";

suite("eventSchema", () => {
  suite("calculateEfficiency", () => {
    test("returns 0 when totalCharacters is 0", () => {
      assert.strictEqual(calculateEfficiency(10, 0), 0);
    });

    test("returns 0 when totalCharacters is negative", () => {
      assert.strictEqual(calculateEfficiency(10, -5), 0);
    });

    test("returns 0 when acceptedCharacters is 0", () => {
      assert.strictEqual(calculateEfficiency(0, 100), 0);
    });

    test("returns correct ratio for typical values", () => {
      const result = calculateEfficiency(50, 200);
      assert.strictEqual(result, 0.25);
    });

    test("returns 1 when accepted equals total", () => {
      assert.strictEqual(calculateEfficiency(100, 100), 1);
    });

    test("caps at 1 when accepted exceeds total", () => {
      assert.strictEqual(calculateEfficiency(150, 100), 1);
    });

    test("handles small fractions correctly", () => {
      const result = calculateEfficiency(1, 1000);
      assert.strictEqual(result, 0.001);
    });
  });

  suite("TrackedEvent type structure", () => {
    test("TextChangeEvent has correct shape", () => {
      const event: TextChangeEvent = {
        sessionId: "sess-1",
        timestamp: "2024-06-01T10:00:00.000Z",
        eventType: "textChange",
        languageId: "typescript",
        charsAdded: 42,
        charsDeleted: 5,
      };
      assert.strictEqual(event.eventType, "textChange");
      assert.strictEqual(event.charsAdded, 42);
      assert.strictEqual(event.charsDeleted, 5);
    });

    test("CompletionAcceptEvent has correct shape", () => {
      const event: CompletionAcceptEvent = {
        sessionId: "sess-1",
        timestamp: "2024-06-01T10:01:00.000Z",
        eventType: "completionAccept",
        languageId: "python",
        modelName: "gpt-4o",
        latencyMs: 320,
        isPartialAccept: false,
        acceptedCharacters: 85,
        openEditorPaths: ["/src/app.ts", "/src/utils.ts"],
      };
      assert.strictEqual(event.eventType, "completionAccept");
      assert.strictEqual(event.modelName, "gpt-4o");
      assert.strictEqual(event.acceptedCharacters, 85);
      assert.strictEqual(event.openEditorPaths.length, 2);
    });

    test("EditorSwitchEvent has correct shape", () => {
      const event: EditorSwitchEvent = {
        sessionId: "sess-1",
        timestamp: "2024-06-01T10:02:00.000Z",
        eventType: "editorSwitch",
        languageId: "rust",
        filePath: "/src/main.rs",
      };
      assert.strictEqual(event.eventType, "editorSwitch");
      assert.strictEqual(event.filePath, "/src/main.rs");
    });

    test("TrackedEvent union is assignable from all event types", () => {
      const events: TrackedEvent[] = [
        {
          sessionId: "s",
          timestamp: "",
          eventType: "textChange",
          languageId: "",
          charsAdded: 0,
          charsDeleted: 0,
        },
        {
          sessionId: "s",
          timestamp: "",
          eventType: "completionAccept",
          languageId: "",
          modelName: "",
          latencyMs: 0,
          isPartialAccept: false,
          acceptedCharacters: 0,
          openEditorPaths: [],
        },
        {
          sessionId: "s",
          timestamp: "",
          eventType: "editorSwitch",
          languageId: "",
          filePath: "",
        },
      ];
      assert.strictEqual(events.length, 3);
    });
  });
});
