/**
 * DB Worker — analytics database running off the main thread.
 *
 * Equivalent to a DuckDB-Wasm Web Worker.  The `@duckdb/duckdb-wasm` package
 * is not used because of an open security advisory on all published versions;
 * {@link InMemoryAnalyticsDb} provides an equivalent in-process store.
 *
 * The worker reads JSONL event files written by {@link EventStorage} (the
 * "write side") and answers analytics queries — similar to how DuckDB would
 * use `read_json_auto` to read the same files.
 *
 * RPC protocol (structured-clone messages):
 *
 * | `type`           | `payload`                      | `result`                         |
 * |------------------|--------------------------------|----------------------------------|
 * | `loadFromJsonl`  | `{ storagePath: string }`      | `{ loaded: number }`             |
 * | `ingest`         | `TrackedEvent[]`               | `{ ingested: number, total: number }` |
 * | `query`          | SQL name string                | row array                        |
 * | `trueRate`       | `{ totalShown?, windowMs? }`   | {@link TrueAcceptanceResult}     |
 * | `velocity`       | `{ windowMs? }`                | {@link VelocityAnalysisResult}   |
 * | `modelPerf`      | —                              | serialisable model-perf result   |
 * | `close`          | —                              | `true`                           |
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parentPort } from "node:worker_threads";
import { InMemoryAnalyticsDb } from "../db/duckdbClient";
import type { TrackedEvent } from "../events/eventSchema";
import { computeModelPerformance, computeTrueAcceptanceRate, computeVelocityAnalysis } from "../metrics/metricsEngine";

const db = new InMemoryAnalyticsDb();

/** Cached events for metrics-engine functions that require the raw list. */
let cachedEvents: TrackedEvent[] = [];

/**
 * Read all JSONL event files from `<storagePath>/events/`.
 *
 * This is the Node.js equivalent of DuckDB's `read_json_auto('events/*.jsonl',
 * ignore_errors = true)` — corrupt lines are silently skipped so that a single
 * malformed entry does not abort the entire analysis.
 */
function loadJsonlDirectory(storagePath: string): TrackedEvent[] {
  const eventsDir = path.join(storagePath, "events");
  const events: TrackedEvent[] = [];
  try {
    const files = fs
      .readdirSync(eventsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    for (const file of files) {
      const filePath = path.join(eventsDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          try {
            events.push(JSON.parse(line) as TrackedEvent);
          } catch {
            // ignore malformed lines (ignore_errors equivalent)
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // events directory does not exist — return empty array
  }
  return events;
}

parentPort?.on("message", async (msg: { type: string; id?: string; payload?: unknown }) => {
  try {
    switch (msg.type) {
      case "loadFromJsonl": {
        const { storagePath } = msg.payload as { storagePath: string };
        const events = loadJsonlDirectory(storagePath);
        cachedEvents = events;
        db.ingest(events);
        const baselines = db.calculateBaselines();
        parentPort?.postMessage({ type: "loadFromJsonl", id: msg.id, result: { loaded: events.length, baselines } });
        break;
      }

      case "ingest": {
        const events = msg.payload as TrackedEvent[];
        cachedEvents = cachedEvents.concat(events);
        db.ingest(events);
        parentPort?.postMessage({ type: "ingest", id: msg.id, result: { ingested: events.length, total: db.size } });
        break;
      }

      case "query": {
        const sql = msg.payload as string;
        const rows = await db.query(sql);
        parentPort?.postMessage({ type: "query", id: msg.id, result: rows });
        break;
      }

      case "trueRate": {
        const opts = (msg.payload ?? {}) as { totalShown?: number; windowMs?: number };
        const result = computeTrueAcceptanceRate(cachedEvents, opts.totalShown ?? 0, opts.windowMs);
        parentPort?.postMessage({ type: "trueRate", id: msg.id, result });
        break;
      }

      case "velocity": {
        const opts = (msg.payload ?? {}) as { windowMs?: number };
        const result = computeVelocityAnalysis(cachedEvents, opts.windowMs);
        parentPort?.postMessage({ type: "velocity", id: msg.id, result });
        break;
      }

      case "modelPerf": {
        const result = computeModelPerformance(cachedEvents);
        // Convert Map → Object for structured-clone compatibility
        const serialisable = {
          crossTab: result.crossTab,
          bestModelByLanguage: Object.fromEntries(result.bestModelByLanguage),
        };
        parentPort?.postMessage({ type: "modelPerf", id: msg.id, result: serialisable });
        break;
      }

      case "baselines": {
        const opts = (msg.payload ?? {}) as { windowDays?: number };
        const result = db.calculateBaselines(opts.windowDays);
        parentPort?.postMessage({ type: "baselines", id: msg.id, result });
        break;
      }

      case "close": {
        await db.close();
        cachedEvents = [];
        parentPort?.postMessage({ type: "close", id: msg.id, result: true });
        break;
      }

      default:
        parentPort?.postMessage({ type: msg.type, id: msg.id, error: `Unknown message type: ${msg.type}` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage({ type: msg.type, id: msg.id, error: message });
  }
});
