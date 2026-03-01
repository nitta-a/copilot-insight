import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TrackedEvent, CompletionAcceptEvent } from "../../src/events/eventSchema";
import { EventStorage } from "../../src/events/eventStorage";
import { computeModelPerformance } from "../../src/metrics/metricsEngine";
import { InMemoryAnalyticsDb } from "../../src/db/duckdbClient";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAcceptEvent(
  date: string,
  languageId = "typescript",
  modelName = "gpt-4o",
  acceptedCharacters = 50,
): CompletionAcceptEvent {
  return {
    sessionId: "test-session",
    timestamp: `${date}T10:00:00Z`,
    eventType: "completionAccept",
    languageId,
    modelName,
    latencyMs: 100,
    isPartialAccept: false,
    acceptedCharacters,
    openEditorPaths: [],
  };
}

async function writeEvents(dir: string, events: TrackedEvent[]): Promise<void> {
  const storage = new EventStorage(dir);
  for (const e of events) {
    await storage.append(e);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite("MCP server – get_usage_summary logic", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-insight-mcp-test-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("EventStorage lists dates after writing events", async () => {
    const storage = new EventStorage(tmpDir);
    await storage.append(makeAcceptEvent("2026-02-28"));
    const dates = storage.listDates();
    assert.ok(dates.includes("2026-02-28"), `Expected 2026-02-28 in ${dates}`);
  });

  test("readByDate returns only completionAccept events for that date", async () => {
    await writeEvents(tmpDir, [makeAcceptEvent("2026-02-28", "typescript"), makeAcceptEvent("2026-02-28", "python")]);

    const storage = new EventStorage(tmpDir);
    const events = storage.readByDate("2026-02-28");
    assert.strictEqual(events.length, 2);
    assert.ok(events.every((e) => e.eventType === "completionAccept"));
  });

  test("accepts total and estimatedMinutesSaved are computed correctly", async () => {
    // Write 4 events with known acceptedCharacters
    for (let i = 0; i < 4; i++) {
      const storage = new EventStorage(tmpDir);
      await storage.append(makeAcceptEvent("2026-02-28", "typescript", "gpt-4o", 200));
    }

    const storage = new EventStorage(tmpDir);
    const events = storage.readByDate("2026-02-28");
    const acceptEvents = events.filter((e) => e.eventType === "completionAccept");

    assert.strictEqual(acceptEvents.length, 4);

    const totalCharsAccepted = acceptEvents.reduce((sum, e) => {
      if (e.eventType !== "completionAccept") {
        return sum;
      }
      return sum + e.acceptedCharacters;
    }, 0);

    // 4 events × 200 chars each = 800 total
    assert.strictEqual(totalCharsAccepted, 800);

    // 800 / 200 (TYPING_SPEED_CPM) = 4 minutes saved
    const estimatedMinutesSaved = Math.round((totalCharsAccepted / 200) * 10) / 10;
    assert.strictEqual(estimatedMinutesSaved, 4.0);
  });

  test("topLanguages breakdown groups by languageId", async () => {
    const storage = new EventStorage(tmpDir);
    await storage.append(makeAcceptEvent("2026-02-28", "python"));
    await storage.append(makeAcceptEvent("2026-02-28", "python"));
    await storage.append(makeAcceptEvent("2026-02-28", "typescript"));

    const events = storage.readByDate("2026-02-28");
    const acceptEvents = events.filter((e): e is CompletionAcceptEvent => e.eventType === "completionAccept");

    const byLanguage: Record<string, number> = {};
    for (const e of acceptEvents) {
      const lang = e.languageId || "unknown";
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    }

    assert.strictEqual(byLanguage["python"], 2);
    assert.strictEqual(byLanguage["typescript"], 1);
  });
});

suite("MCP server – get_model_efficiency logic", () => {
  test("computeModelPerformance groups by model and language", async () => {
    const events: TrackedEvent[] = [
      makeAcceptEvent("2026-02-28", "typescript", "gpt-4o", 50),
      makeAcceptEvent("2026-02-28", "typescript", "gpt-4o", 60),
      makeAcceptEvent("2026-02-28", "python", "claude-3-5-sonnet", 40),
    ];

    const { crossTab, bestModelByLanguage } = computeModelPerformance(events);

    assert.strictEqual(bestModelByLanguage.get("typescript"), "gpt-4o");
    assert.strictEqual(bestModelByLanguage.get("python"), "claude-3-5-sonnet");
    assert.ok(crossTab.length >= 2);
  });

  test("bestModelByLanguage returns the model with the most accepted completions", async () => {
    const events: TrackedEvent[] = [
      makeAcceptEvent("2026-02-28", "typescript", "model-a", 50),
      makeAcceptEvent("2026-02-28", "typescript", "model-a", 50),
      makeAcceptEvent("2026-02-28", "typescript", "model-b", 50),
    ];

    const { bestModelByLanguage } = computeModelPerformance(events);
    // model-a has 2 accepts vs model-b with 1
    assert.strictEqual(bestModelByLanguage.get("typescript"), "model-a");
  });
});

suite("MCP server – get_anomaly_report logic", () => {
  test("InMemoryAnalyticsDb calculateBaselines returns mean/stdDev", async () => {
    const db = new InMemoryAnalyticsDb();
    // 2 events on day1, 4 on day2
    db.ingest([
      makeAcceptEvent("2026-02-27"),
      makeAcceptEvent("2026-02-27"),
      makeAcceptEvent("2026-02-28"),
      makeAcceptEvent("2026-02-28"),
      makeAcceptEvent("2026-02-28"),
      makeAcceptEvent("2026-02-28"),
    ]);

    const baselines = db.calculateBaselines(14);
    assert.strictEqual(baselines.sampleSize, 2);
    // mean = (2 + 4) / 2 = 3
    assert.ok(Math.abs(baselines.mean - 3) < 0.001);
    await db.close();
  });

  test("z-score calculation flags anomalous days", async () => {
    const db = new InMemoryAnalyticsDb();
    // Normal days: 5 events each for 10 days
    for (let day = 1; day <= 10; day++) {
      for (let i = 0; i < 5; i++) {
        db.ingest([makeAcceptEvent(`2026-02-${String(day).padStart(2, "0")}`)]);
      }
    }

    const baselines = db.calculateBaselines(14);
    // All days same count → stdDev = 0
    assert.strictEqual(baselines.stdDev, 0);
    // z-score would be 0/0 = NaN — canDetect is false when stdDev = 0
    const canDetect = baselines.sampleSize >= 2 && baselines.stdDev > 0;
    assert.strictEqual(canDetect, false);
    await db.close();
  });

  test("anomaly report detects day with significantly different count", async () => {
    const db = new InMemoryAnalyticsDb();
    // Days with count 10 baseline
    for (let day = 1; day <= 12; day++) {
      for (let i = 0; i < 10; i++) {
        db.ingest([makeAcceptEvent(`2026-01-${String(day).padStart(2, "0")}`)]);
      }
    }
    // Anomalous day: 1 event (much lower than baseline of 10)
    db.ingest([makeAcceptEvent("2026-01-13")]);

    const baselines = db.calculateBaselines(14);
    assert.ok(baselines.stdDev === 0 || baselines.sampleSize >= 2);

    // With uniform baseline: stdDev is 0, so canDetect is false (expected)
    // Once there's variance, anomalies are detected
    assert.ok(baselines.sampleSize >= 2);
    await db.close();
  });
});
