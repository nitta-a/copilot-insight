/**
 * Worker thread that runs analytics computations off the main thread.
 *
 * Phase 1 of the roadmap: Web Worker integration to prevent heavy DB
 * operations (aggregation, cross-tabulation) from blocking the editor's
 * main thread.
 *
 * Communication protocol:
 * - Main thread sends `{ type, payload }` messages via `parentPort`.
 * - Worker replies with `{ type, result }` or `{ type, error }`.
 *
 * Supported message types:
 * - `ingest`       — load events into the in-memory DB
 * - `query`        — run a named query on the DB
 * - `trueRate`     — compute true acceptance rate
 * - `velocity`     — compute KPM velocity analysis
 * - `modelPerf`    — compute model performance cross-tab
 * - `close`        — release resources and exit
 */

import { parentPort } from "node:worker_threads";
import { InMemoryAnalyticsDb } from "./duckdbClient";
import type { TrackedEvent } from "./eventSchema";
import { computeModelPerformance, computeTrueAcceptanceRate, computeVelocityAnalysis } from "./metricsEngine";

const db = new InMemoryAnalyticsDb();

/** Cached events for metrics-engine functions that need the raw list. */
let cachedEvents: TrackedEvent[] = [];

parentPort?.on("message", async (msg: { type: string; id?: string; payload?: unknown }) => {
  try {
    switch (msg.type) {
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
        // Convert Map to Object for structured-clone compatibility
        const serialisable = {
          crossTab: result.crossTab,
          bestModelByLanguage: Object.fromEntries(result.bestModelByLanguage),
        };
        parentPort?.postMessage({ type: "modelPerf", id: msg.id, result: serialisable });
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
