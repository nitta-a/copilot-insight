import * as assert from "assert";
import type { EventRecord, FileMetadataRecord, SessionRecord } from "../../src/db/dbSchema";
import { buildFileMetadataRecords, buildSessionRecords, normaliseEvent } from "../../src/db/dbSchema";

suite("dbSchema", () => {
  suite("normaliseEvent", () => {
    test("normalises a textChange event", () => {
      const raw = {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "typescript",
        charsAdded: 42,
        charsDeleted: 5,
      };
      const record = normaliseEvent(raw, 0);
      assert.strictEqual(record.id, 0);
      assert.strictEqual(record.sessionId, "s1");
      assert.strictEqual(record.eventType, "textChange");
      assert.strictEqual(record.charsAdded, 42);
      assert.strictEqual(record.charsDeleted, 5);
      assert.strictEqual(record.acceptedCharacters, 0);
      assert.strictEqual(record.modelName, "");
    });

    test("normalises a completionAccept event", () => {
      const raw = {
        sessionId: "s1",
        timestamp: "2026-02-28T10:01:00Z",
        eventType: "completionAccept",
        languageId: "python",
        acceptedCharacters: 85,
        modelName: "gpt-4o",
        latencyMs: 320,
        isPartialAccept: false,
      };
      const record = normaliseEvent(raw, 7);
      assert.strictEqual(record.id, 7);
      assert.strictEqual(record.modelName, "gpt-4o");
      assert.strictEqual(record.acceptedCharacters, 85);
      assert.strictEqual(record.latencyMs, 320);
      assert.strictEqual(record.isPartialAccept, false);
    });

    test("fills defaults for missing optional fields", () => {
      const raw = {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "editorSwitch",
        languageId: "go",
      };
      const record = normaliseEvent(raw, 99);
      assert.strictEqual(record.charsAdded, 0);
      assert.strictEqual(record.charsDeleted, 0);
      assert.strictEqual(record.filePath, "");
      assert.strictEqual(record.modelName, "");
      assert.strictEqual(record.isSubagent, false);
      assert.strictEqual(record.intent, "");
    });

    test("normalises isSubagent and intent fields", () => {
      const raw = {
        sessionId: "s1",
        timestamp: "2026-02-28T10:02:00Z",
        eventType: "completionAccept",
        languageId: "typescript",
        isSubagent: true,
        intent: "runSubagent",
      };
      const record = normaliseEvent(raw, 5);
      assert.strictEqual(record.isSubagent, true);
      assert.strictEqual(record.intent, "runSubagent");
    });
  });

  suite("buildSessionRecords", () => {
    test("groups events by session and derives time range", () => {
      const events: EventRecord[] = [
        makeRecord({ sessionId: "a", timestamp: "2026-02-28T10:00:00Z" }),
        makeRecord({ sessionId: "a", timestamp: "2026-02-28T11:00:00Z" }),
        makeRecord({ sessionId: "b", timestamp: "2026-02-28T12:00:00Z" }),
      ];
      const sessions = buildSessionRecords(events);
      assert.strictEqual(sessions.length, 2);

      const sessionA = sessions.find((s) => s.sessionId === "a");
      assert.ok(sessionA);
      assert.strictEqual(sessionA.startedAt, "2026-02-28T10:00:00Z");
      assert.strictEqual(sessionA.endedAt, "2026-02-28T11:00:00Z");

      const sessionB = sessions.find((s) => s.sessionId === "b");
      assert.ok(sessionB);
      assert.strictEqual(sessionB.startedAt, "2026-02-28T12:00:00Z");
    });

    test("returns empty array for empty input", () => {
      assert.deepStrictEqual(buildSessionRecords([]), []);
    });
  });

  suite("buildFileMetadataRecords", () => {
    test("aggregates file-level statistics", () => {
      const events: EventRecord[] = [
        makeRecord({ filePath: "/src/app.ts", eventType: "textChange" }),
        makeRecord({ filePath: "/src/app.ts", eventType: "textChange" }),
        makeRecord({ filePath: "/src/app.ts", eventType: "completionAccept", acceptedCharacters: 50 }),
        makeRecord({ filePath: "/src/util.ts", eventType: "completionAccept", acceptedCharacters: 20 }),
      ];
      const records = buildFileMetadataRecords(events);
      assert.strictEqual(records.length, 2);

      const appRecord = records.find((r) => r.filePath === "/src/app.ts");
      assert.ok(appRecord);
      assert.strictEqual(appRecord.totalEdits, 2);
      assert.strictEqual(appRecord.totalAcceptedCompletions, 1);
      assert.strictEqual(appRecord.totalAcceptedCharacters, 50);
    });

    test("ignores events without filePath", () => {
      const events: EventRecord[] = [makeRecord({ filePath: "", eventType: "textChange" })];
      assert.deepStrictEqual(buildFileMetadataRecords(events), []);
    });
  });
});

/** Helper to build a partial EventRecord with sensible defaults. */
function makeRecord(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: 0,
    sessionId: "s1",
    timestamp: "2026-02-28T10:00:00Z",
    eventType: "textChange",
    languageId: "typescript",
    charsAdded: 0,
    charsDeleted: 0,
    acceptedCharacters: 0,
    modelName: "",
    latencyMs: 0,
    isPartialAccept: false,
    filePath: "",
    isSubagent: false,
    intent: "",
    signalType: "",
    actor: "",
    phase: "",
    rawText: "",
    success: true,
    ...overrides,
  };
}
