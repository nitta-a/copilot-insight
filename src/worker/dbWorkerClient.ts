/**
 * Main-thread RPC client for the {@link dbWorker}.
 *
 * Wraps `worker_threads.Worker` in a promise-based API so callers can `await`
 * each operation without dealing with the message-passing protocol directly.
 *
 * Compared with {@link MetricsWorkerClient}, this client also exposes
 * `loadFromJsonl()` which tells the worker to read JSONL event files from
 * disk — equivalent to DuckDB's `read_json_auto`.
 *
 * Usage:
 * ```ts
 * const client = new DbWorkerClientImpl(workerPath);
 * await client.loadFromJsonl(context.globalStorageUri.fsPath);
 * const rate = await client.trueRate(totalShown);
 * await client.close();
 * ```
 */

import { Worker } from "node:worker_threads";
import type { TrackedEvent } from "../events/eventSchema";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";

/**
 * Async interface for the DB worker, modelled after {@link DuckDbClient}.
 * Use this type for mocks and dependency injection in tests.
 */
export interface DbWorkerClient {
  loadFromJsonl(storagePath: string): Promise<{ loaded: number }>;
  ingest(events: TrackedEvent[]): Promise<{ ingested: number; total: number }>;
  query<T = unknown>(sql: string): Promise<T[]>;
  trueRate(totalShown: number, windowMs?: number): Promise<TrueAcceptanceResult>;
  velocity(windowMs?: number): Promise<VelocityAnalysisResult>;
  modelPerformance(): Promise<ModelPerformanceResult>;
  compact(ttlMs?: number): Promise<{ compacted: number }>;
  close(): Promise<void>;
}

export class DbWorkerClientImpl implements DbWorkerClient {
  private _worker: Worker | undefined;
  private _pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _idCounter = 0;

  /**
   * @param workerPath  Absolute path to the compiled `dbWorker.js` file.
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

  /** Send a typed message and wait for the correlated response. */
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

  /**
   * Instruct the worker to load all JSONL event files from
   * `<storagePath>/events/` into its in-memory analytics database.
   *
   * This is equivalent to DuckDB's `read_json_auto('events/*.jsonl',
   * ignore_errors = true)`.
   */
  async loadFromJsonl(storagePath: string): Promise<{ loaded: number }> {
    return (await this._send("loadFromJsonl", { storagePath })) as { loaded: number };
  }

  /** Ingest in-memory events directly (bypassing JSONL files). */
  async ingest(events: TrackedEvent[]): Promise<{ ingested: number; total: number }> {
    return (await this._send("ingest", events)) as { ingested: number; total: number };
  }

  /** Run a named query on the worker's analytics database. */
  async query<T = unknown>(sql: string): Promise<T[]> {
    return (await this._send("query", sql)) as T[];
  }

  /** Compute true acceptance rate (SQL-equivalent via worker). */
  async trueRate(totalShown: number, windowMs?: number): Promise<TrueAcceptanceResult> {
    return (await this._send("trueRate", { totalShown, windowMs })) as TrueAcceptanceResult;
  }

  /** Compute typing-velocity (KPM) analysis (SQL-equivalent via worker). */
  async velocity(windowMs?: number): Promise<VelocityAnalysisResult> {
    return (await this._send("velocity", { windowMs })) as VelocityAnalysisResult;
  }

  /** Compute model-performance cross-tabulation (SQL-equivalent via worker). */
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

  /** Compact events older than `ttlMs` into daily aggregated stats. */
  async compact(ttlMs?: number): Promise<{ compacted: number }> {
    return (await this._send("compact", { ttlMs })) as { compacted: number };
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
