/**
 * Main-thread client for communicating with the metrics worker.
 *
 * Wraps `worker_threads.Worker` in a promise-based API so that callers
 * can `await` each operation without dealing with the message protocol
 * directly.
 *
 * Usage:
 * ```ts
 * const client = new MetricsWorkerClient(workerPath);
 * await client.ingest(events);
 * const rate = await client.trueRate(totalShown);
 * await client.close();
 * ```
 */

import { Worker } from "node:worker_threads";
import type { TrackedEvent } from "../events/eventSchema";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "./metricsEngine";

export class MetricsWorkerClient {
  private _worker: Worker | undefined;
  private _pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _idCounter = 0;

  /**
   * @param workerPath  Absolute path to the compiled `metricsWorker.js` file.
   */
  constructor(workerPath: string) {
    this._worker = new Worker(workerPath);
    this._worker.on("message", (msg: { type: string; id: string; result?: unknown; error?: string }) => {
      const key = msg.id ?? msg.type;
      const entry = this._pending.get(key);
      if (!entry) {
        return;
      }
      this._pending.delete(key);
      if (msg.error) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg.result);
      }
    });
    this._worker.on("error", (err) => {
      for (const entry of this._pending.values()) {
        entry.reject(err);
      }
      this._pending.clear();
    });
  }

  /** Send a typed message and wait for the response, using a unique id for correlation. */
  private _send(type: string, payload?: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this._worker) {
        reject(new Error("Worker has been terminated"));
        return;
      }
      const id = `${type}:${this._idCounter++}`;
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ type, id, payload });
    });
  }

  /** Ingest events into the worker's in-memory database. */
  async ingest(events: TrackedEvent[]): Promise<{ ingested: number; total: number }> {
    return (await this._send("ingest", events)) as { ingested: number; total: number };
  }

  /** Run a named query on the worker's database. */
  async query<T = unknown>(sql: string): Promise<T[]> {
    return (await this._send("query", sql)) as T[];
  }

  /** Compute true acceptance rate. */
  async trueRate(totalShown: number, windowMs?: number): Promise<TrueAcceptanceResult> {
    return (await this._send("trueRate", { totalShown, windowMs })) as TrueAcceptanceResult;
  }

  /** Compute velocity (KPM) analysis. */
  async velocity(windowMs?: number): Promise<VelocityAnalysisResult> {
    return (await this._send("velocity", { windowMs })) as VelocityAnalysisResult;
  }

  /** Compute model performance cross-tabulation. */
  async modelPerformance(): Promise<ModelPerformanceResult> {
    const raw = (await this._send("modelPerf")) as {
      crossTab: ModelPerformanceResult["crossTab"];
      bestModelByLanguage: Record<string, string>;
    };
    return {
      crossTab: raw.crossTab,
      bestModelByLanguage: new Map(Object.entries(raw.bestModelByLanguage)),
    };
  }

  /** Shut down the worker thread and release all resources. */
  async close(): Promise<void> {
    if (!this._worker) {
      return;
    }
    try {
      await this._send("close");
    } catch {
      // Worker may have already exited
    }
    await this._worker.terminate();
    this._worker = undefined;
    this._pending.clear();
  }
}
