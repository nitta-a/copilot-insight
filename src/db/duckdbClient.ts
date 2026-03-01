import type { AggregatedDailyStats, EventRecord } from "./dbSchema";
import { buildFileMetadataRecords, buildSessionRecords, normaliseEvent } from "./dbSchema";
import type { TrackedEvent } from "../events/eventSchema";

/** A single row returned from a DuckDB query. */
export type DuckDbRow = Record<string, unknown>;

/** Minimal async interface for DuckDB access within the extension. */
export interface DuckDbClient {
  /** Execute a SQL statement and return the result rows as plain objects. */
  query<T extends DuckDbRow = DuckDbRow>(sql: string): Promise<T[]>;
  /** Release all DuckDB resources. */
  close(): Promise<void>;
}

/**
 * Initialise an in-memory DuckDB instance and return a client.
 *
 * The DuckDB (Wasm) package is not yet wired in due to a security advisory on
 * all published versions of `@duckdb/duckdb-wasm`. This factory is a placeholder
 * that preserves the interface contract; the body will be filled in once a
 * safe version of the package becomes available.
 */
export async function createDuckDbClient(): Promise<DuckDbClient> {
  throw new Error("DuckDB is not yet available: the @duckdb/duckdb-wasm package has an open security advisory.");
}

/**
 * In-memory analytics database that implements the {@link DuckDbClient}
 * interface using normalised event data.
 *
 * This is a lightweight alternative to DuckDB (Wasm) that can be used while
 * the `@duckdb/duckdb-wasm` package has an open security advisory.  It stores
 * events in typed arrays and supports a small set of well-known analytical
 * queries by name (passed as the `sql` argument to {@link query}).
 *
 * Supported query names:
 * - `sessions`          → all session records
 * - `events`            → all (recent, non-compacted) event records
 * - `file_metadata`     → aggregated per-file statistics
 * - `events_by_type:<type>` → events filtered by eventType
 * - `aggregated_stats`  → daily {@link AggregatedDailyStats} produced by {@link compact}
 */
export class InMemoryAnalyticsDb implements DuckDbClient {
  private _events: EventRecord[] = [];
  private _aggregated: Map<string, AggregatedDailyStats> = new Map();
  private _closed = false;

  /** Number of events currently stored. */
  get size(): number {
    return this._events.length;
  }

  /** Insert raw tracked events into the normalised store. */
  ingest(rawEvents: TrackedEvent[]): void {
    if (this._closed) {
      return;
    }
    const baseId = this._events.length;
    for (let i = 0; i < rawEvents.length; i++) {
      this._events.push(normaliseEvent(rawEvents[i], baseId + i));
    }
  }

  /** Insert pre-normalised event records. */
  ingestRecords(records: EventRecord[]): void {
    if (this._closed) {
      return;
    }
    this._events.push(...records);
  }

  async query<T extends DuckDbRow = DuckDbRow>(sql: string): Promise<T[]> {
    if (this._closed) {
      return [];
    }
    const trimmed = sql.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "sessions") {
      return buildSessionRecords(this._events) as unknown as T[];
    }
    if (lower === "events") {
      return this._events as unknown as T[];
    }
    if (lower === "file_metadata") {
      return buildFileMetadataRecords(this._events) as unknown as T[];
    }
    if (lower.startsWith("events_by_type:")) {
      const eventType = trimmed.slice("events_by_type:".length).trim();
      return this._events.filter((e) => e.eventType === eventType) as unknown as T[];
    }
    if (lower === "aggregated_stats") {
      const rows = Array.from(this._aggregated.values()).sort((a, b) => a.date.localeCompare(b.date));
      return rows as unknown as T[];
    }
    return [];
  }

  /**
   * Compact raw events older than `ttlMs` milliseconds into daily
   * {@link AggregatedDailyStats} summaries and free the original
   * {@link EventRecord} objects.
   *
   * Call this periodically (e.g., once per hour) to keep memory usage
   * constant even after days of continuous IDE usage.
   *
   * @param ttlMs  Age threshold in milliseconds.  Events whose `timestamp`
   *               is older than `Date.now() - ttlMs` are compacted.
   *               Defaults to 24 hours.
   * @returns      The number of raw events that were compacted.
   */
  compact(ttlMs = 24 * 60 * 60 * 1000): number {
    if (this._closed) {
      return 0;
    }
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const stale: EventRecord[] = [];
    const fresh: EventRecord[] = [];
    for (const event of this._events) {
      if (event.timestamp < cutoff) {
        stale.push(event);
      } else {
        fresh.push(event);
      }
    }
    if (stale.length === 0) {
      return 0;
    }
    for (const event of stale) {
      const date = event.timestamp.slice(0, 10); // "YYYY-MM-DD"
      const existing = this._aggregated.get(date) ?? {
        date,
        totalAccepted: 0,
        totalCharsAdded: 0,
        totalCharsDeleted: 0,
        totalAcceptedCharacters: 0,
      };
      existing.totalCharsAdded += event.charsAdded ?? 0;
      existing.totalCharsDeleted += event.charsDeleted ?? 0;
      if (event.eventType === "completionAccept") {
        existing.totalAccepted++;
        existing.totalAcceptedCharacters += event.acceptedCharacters ?? 0;
      }
      this._aggregated.set(date, existing);
    }
    this._events = fresh;
    return stale.length;
  }

  /**
   * Compute the mean and standard deviation of daily accepted-completion
   * counts over the last `windowDays` days of stored data.
   *
   * This provides the statistical baseline for anomaly detection: callers
   * can compare any single day's count against `mean ± ANOMALY_Z_THRESHOLD *
   * stdDev` to decide whether that day is an outlier.
   *
   * Edge cases:
   * - Returns `{ mean: 0, stdDev: 0, sampleSize: 0 }` when the database is
   *   closed or contains no `completionAccept` events.
   * - When only one day of data is available `stdDev` will be `0`, which
   *   means no anomaly can be detected — callers should skip detection when
   *   `sampleSize < 2`.
   */
  calculateBaselines(windowDays = 14): { mean: number; stdDev: number; sampleSize: number } {
    if (this._closed) {
      return { mean: 0, stdDev: 0, sampleSize: 0 };
    }

    // Aggregate accepted-completion events by calendar date (UTC).
    const dailyCounts = new Map<string, number>();

    // Include historical daily summaries produced by compact().
    for (const [date, stats] of this._aggregated) {
      dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + stats.totalAccepted);
    }

    // Include recent raw events (not yet compacted).
    for (const event of this._events) {
      if (event.eventType !== "completionAccept") {
        continue;
      }
      const date = event.timestamp.slice(0, 10); // "YYYY-MM-DD"
      dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + 1);
    }

    const sortedDates = [...dailyCounts.keys()].sort().slice(-windowDays);
    const counts = sortedDates.map((d) => dailyCounts.get(d) ?? 0);

    if (counts.length === 0) {
      return { mean: 0, stdDev: 0, sampleSize: 0 };
    }

    const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
    const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev, sampleSize: counts.length };
  }

  async close(): Promise<void> {
    this._closed = true;
    this._events = [];
    this._aggregated.clear();
  }
}
