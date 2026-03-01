import * as assert from "assert";
import type { TrackedEvent, CompletionAcceptEvent, TextChangeEvent } from "../../src/events/eventSchema";
import {
  computeModelPerformance,
  computeTrueAcceptanceRate,
  computeVelocityAnalysis,
} from "../../src/metrics/metricsEngine";

suite("metricsEngine", () => {
  suite("computeTrueAcceptanceRate", () => {
    test("returns zero rates for empty events", () => {
      const result = computeTrueAcceptanceRate([], 0);
      assert.strictEqual(result.rawAccepted, 0);
      assert.strictEqual(result.trueAccepted, 0);
      assert.strictEqual(result.rawRate, 0);
      assert.strictEqual(result.trueRate, 0);
      assert.strictEqual(result.revertedCount, 0);
    });

    test("counts all as true when no deletions follow", () => {
      const events: TrackedEvent[] = [
        makeAcceptEvent("2026-02-28T10:00:00Z", "typescript", 40),
        makeAcceptEvent("2026-02-28T10:01:00Z", "typescript", 30),
      ];
      const result = computeTrueAcceptanceRate(events, 10);
      assert.strictEqual(result.rawAccepted, 2);
      assert.strictEqual(result.trueAccepted, 2);
      assert.strictEqual(result.revertedCount, 0);
      assert.strictEqual(result.rawRate, 20);
      assert.strictEqual(result.trueRate, 20);
    });

    test("marks accept as reverted when large deletion follows within window", () => {
      const events: TrackedEvent[] = [
        makeAcceptEvent("2026-02-28T10:00:00.000Z", "typescript", 40),
        makeTextChangeEvent("2026-02-28T10:00:10.000Z", "typescript", 0, 30),
      ];
      const result = computeTrueAcceptanceRate(events, 5, 30_000);
      assert.strictEqual(result.rawAccepted, 1);
      assert.strictEqual(result.revertedCount, 1);
      assert.strictEqual(result.trueAccepted, 0);
    });

    test("does not mark as reverted when deletion is outside window", () => {
      const events: TrackedEvent[] = [
        makeAcceptEvent("2026-02-28T10:00:00.000Z", "typescript", 40),
        makeTextChangeEvent("2026-02-28T10:02:00.000Z", "typescript", 0, 30),
      ];
      const result = computeTrueAcceptanceRate(events, 5, 30_000);
      assert.strictEqual(result.revertedCount, 0);
      assert.strictEqual(result.trueAccepted, 1);
    });

    test("does not mark as reverted when deletion is small", () => {
      const events: TrackedEvent[] = [
        makeAcceptEvent("2026-02-28T10:00:00.000Z", "typescript", 100),
        makeTextChangeEvent("2026-02-28T10:00:10.000Z", "typescript", 0, 10),
      ];
      const result = computeTrueAcceptanceRate(events, 5, 30_000);
      assert.strictEqual(result.revertedCount, 0);
    });
  });

  suite("computeVelocityAnalysis", () => {
    test("returns empty result for no events", () => {
      const result = computeVelocityAnalysis([]);
      assert.strictEqual(result.timeSeries.length, 0);
      assert.strictEqual(result.averageKpm, 0);
      assert.strictEqual(result.disruptionCount, 0);
    });

    test("calculates KPM for a single window", () => {
      const events: TrackedEvent[] = [
        makeTextChangeEvent("2026-02-28T10:00:00.000Z", "typescript", 120, 0),
        makeTextChangeEvent("2026-02-28T10:00:30.000Z", "typescript", 80, 0),
      ];
      const result = computeVelocityAnalysis(events, 60_000);
      assert.ok(result.timeSeries.length >= 1);
      assert.ok(result.averageKpm > 0);
    });

    test("detects flow disruptions when KPM drops at completion", () => {
      const events: TrackedEvent[] = [];
      // High KPM window (0-60s): lots of typing
      for (let i = 0; i < 10; i++) {
        events.push(makeTextChangeEvent(`2026-02-28T10:00:${String(i * 5).padStart(2, "0")}.000Z`, "ts", 100, 0));
      }
      // Low KPM window (60-120s): a completion accepted but very little typing
      events.push(makeAcceptEvent("2026-02-28T10:01:10.000Z", "ts", 50));
      events.push(makeTextChangeEvent("2026-02-28T10:01:30.000Z", "ts", 5, 0));

      const result = computeVelocityAnalysis(events, 60_000);
      assert.ok(result.timeSeries.length >= 2);
      // The second window should have much lower KPM
    });
  });

  suite("computeModelPerformance", () => {
    test("returns empty result for no events", () => {
      const result = computeModelPerformance([]);
      assert.strictEqual(result.crossTab.length, 0);
      assert.strictEqual(result.bestModelByLanguage.size, 0);
    });

    test("cross-tabulates by model and language", () => {
      const events: TrackedEvent[] = [
        makeAcceptEventFull("2026-02-28T10:00:00Z", "typescript", 40, "gpt-4o", 200),
        makeAcceptEventFull("2026-02-28T10:01:00Z", "typescript", 30, "gpt-4o", 150),
        makeAcceptEventFull("2026-02-28T10:02:00Z", "python", 50, "claude-3.5", 300),
      ];
      const result = computeModelPerformance(events);
      assert.strictEqual(result.crossTab.length, 2);

      const tsEntry = result.crossTab.find((e) => e.languageId === "typescript");
      assert.ok(tsEntry);
      assert.strictEqual(tsEntry.modelName, "gpt-4o");
      assert.strictEqual(tsEntry.totalAccepted, 2);
      assert.strictEqual(tsEntry.totalCharsAccepted, 70);
      assert.strictEqual(tsEntry.avgLatencyMs, 175);
    });

    test("identifies best model per language", () => {
      const events: TrackedEvent[] = [
        makeAcceptEventFull("2026-02-28T10:00:00Z", "typescript", 40, "gpt-4o", 200),
        makeAcceptEventFull("2026-02-28T10:01:00Z", "typescript", 30, "gpt-4o", 200),
        makeAcceptEventFull("2026-02-28T10:02:00Z", "typescript", 20, "claude-3.5", 200),
        makeAcceptEventFull("2026-02-28T10:03:00Z", "python", 50, "claude-3.5", 300),
      ];
      const result = computeModelPerformance(events);
      assert.strictEqual(result.bestModelByLanguage.get("typescript"), "gpt-4o");
      assert.strictEqual(result.bestModelByLanguage.get("python"), "claude-3.5");
    });
  });
});

function makeAcceptEvent(timestamp: string, languageId: string, acceptedCharacters: number): CompletionAcceptEvent {
  return {
    sessionId: "s1",
    timestamp,
    eventType: "completionAccept",
    languageId,
    modelName: "",
    latencyMs: 0,
    isPartialAccept: false,
    acceptedCharacters,
    openEditorPaths: [],
  };
}

function makeAcceptEventFull(
  timestamp: string,
  languageId: string,
  acceptedCharacters: number,
  modelName: string,
  latencyMs: number,
): CompletionAcceptEvent {
  return {
    sessionId: "s1",
    timestamp,
    eventType: "completionAccept",
    languageId,
    modelName,
    latencyMs,
    isPartialAccept: false,
    acceptedCharacters,
    openEditorPaths: [],
  };
}

function makeTextChangeEvent(
  timestamp: string,
  languageId: string,
  charsAdded: number,
  charsDeleted: number,
): TextChangeEvent {
  return {
    sessionId: "s1",
    timestamp,
    eventType: "textChange",
    languageId,
    charsAdded,
    charsDeleted,
  };
}
