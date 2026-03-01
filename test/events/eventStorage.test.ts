import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TextChangeEvent, TrackedEvent } from "../../src/events/eventSchema";
import { EventStorage } from "../../src/events/eventStorage";

/** Create a fresh temp directory for each test. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "event-storage-test-"));
}

/** Remove a directory tree (cleanup). */
function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

suite("EventStorage", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = makeTempDir();
  });

  teardown(() => {
    rmrf(tmpDir);
  });

  test("append creates events directory and writes JSONL file", async () => {
    const storage = new EventStorage(tmpDir);
    const event: TextChangeEvent = {
      sessionId: "s1",
      timestamp: "2024-06-15T10:00:00.000Z",
      eventType: "textChange",
      languageId: "typescript",
      charsAdded: 10,
      charsDeleted: 2,
    };
    await storage.append(event);

    const filePath = path.join(tmpDir, "events", "2024-06-15.jsonl");
    assert.ok(fs.existsSync(filePath));

    const content = fs.readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(content) as TextChangeEvent;
    assert.strictEqual(parsed.eventType, "textChange");
    assert.strictEqual(parsed.charsAdded, 10);
  });

  test("append adds multiple events to the same date file", async () => {
    const storage = new EventStorage(tmpDir);
    for (let i = 0; i < 3; i++) {
      await storage.append({
        sessionId: "s1",
        timestamp: "2024-06-15T10:00:00.000Z",
        eventType: "textChange",
        languageId: "ts",
        charsAdded: i,
        charsDeleted: 0,
      } as TextChangeEvent);
    }

    const filePath = path.join(tmpDir, "events", "2024-06-15.jsonl");
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    assert.strictEqual(lines.length, 3);
  });

  test("readByDate returns stored events", async () => {
    const storage = new EventStorage(tmpDir);
    await storage.append({
      sessionId: "s1",
      timestamp: "2024-06-20T08:00:00.000Z",
      eventType: "textChange",
      languageId: "python",
      charsAdded: 5,
      charsDeleted: 1,
    } as TextChangeEvent);

    const events = storage.readByDate("2024-06-20");
    assert.strictEqual(events.length, 1);
    assert.strictEqual((events[0] as TextChangeEvent).charsAdded, 5);
  });

  test("readByDate returns empty array for missing date", () => {
    const storage = new EventStorage(tmpDir);
    const events = storage.readByDate("2099-01-01");
    assert.deepStrictEqual(events, []);
  });

  test("readByDate skips malformed lines", () => {
    const storage = new EventStorage(tmpDir);
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "2024-06-25.jsonl"),
      '{"eventType":"textChange","sessionId":"s","timestamp":"","languageId":"","charsAdded":1,"charsDeleted":0}\n{INVALID JSON}\n',
      "utf-8",
    );

    const events = storage.readByDate("2024-06-25");
    assert.strictEqual(events.length, 1);
  });

  test("listDates returns sorted date strings", async () => {
    const storage = new EventStorage(tmpDir);
    await storage.append({
      sessionId: "s",
      timestamp: "2024-06-20T00:00:00Z",
      eventType: "textChange",
      languageId: "",
      charsAdded: 1,
      charsDeleted: 0,
    } as TextChangeEvent);
    await storage.append({
      sessionId: "s",
      timestamp: "2024-06-18T00:00:00Z",
      eventType: "textChange",
      languageId: "",
      charsAdded: 1,
      charsDeleted: 0,
    } as TextChangeEvent);

    const dates = storage.listDates();
    assert.deepStrictEqual(dates, ["2024-06-18", "2024-06-20"]);
  });

  test("listDates returns empty array when directory does not exist", () => {
    const storage = new EventStorage(path.join(tmpDir, "nonexistent"));
    assert.deepStrictEqual(storage.listDates(), []);
  });

  test("dispose prevents further writes", async () => {
    const storage = new EventStorage(tmpDir);
    storage.dispose();
    await storage.append({
      sessionId: "s",
      timestamp: "2024-06-30T00:00:00Z",
      eventType: "textChange",
      languageId: "",
      charsAdded: 1,
      charsDeleted: 0,
    } as TextChangeEvent);

    const events = storage.readByDate("2024-06-30");
    assert.strictEqual(events.length, 0);
  });

  test("append handles events with different dates into separate files", async () => {
    const storage = new EventStorage(tmpDir);
    const dates = ["2024-06-10", "2024-06-11", "2024-06-12"];
    for (const d of dates) {
      await storage.append({
        sessionId: "s",
        timestamp: `${d}T12:00:00Z`,
        eventType: "editorSwitch",
        languageId: "go",
        filePath: "/main.go",
      } as TrackedEvent);
    }

    const listed = storage.listDates();
    assert.deepStrictEqual(listed, dates);
  });
});
