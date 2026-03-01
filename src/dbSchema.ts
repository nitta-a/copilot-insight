/**
 * Database schema definitions for the analytics pipeline.
 *
 * Phase 1 of the roadmap: normalized table schemas for sessions, events, and
 * file metadata.  These TypeScript interfaces mirror the conceptual SQL tables
 * and are used by the in-memory analytics engine.
 */

/** Row in the `sessions` table — one entry per VS Code session. */
export interface SessionRecord {
  sessionId: string;
  startedAt: string;
  endedAt: string;
}

/** Row in the `events` table — every tracked event in normalised form. */
export interface EventRecord {
  id: number;
  sessionId: string;
  timestamp: string;
  eventType: "textChange" | "completionAccept" | "editorSwitch";
  languageId: string;
  charsAdded: number;
  charsDeleted: number;
  acceptedCharacters: number;
  modelName: string;
  latencyMs: number;
  isPartialAccept: boolean;
  filePath: string;
}

/** Row in the `file_metadata` table — aggregated per-file statistics. */
export interface FileMetadataRecord {
  filePath: string;
  languageId: string;
  totalEdits: number;
  totalAcceptedCompletions: number;
  totalAcceptedCharacters: number;
}

/** SQL DDL statements (for documentation / future DuckDB integration). */
export const TABLE_DDL = {
  sessions: `CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  started_at   TEXT NOT NULL,
  ended_at     TEXT NOT NULL
);`,
  events: `CREATE TABLE IF NOT EXISTS events (
  id                   INTEGER PRIMARY KEY,
  session_id           TEXT NOT NULL,
  timestamp            TEXT NOT NULL,
  event_type           TEXT NOT NULL,
  language_id          TEXT,
  chars_added          INTEGER DEFAULT 0,
  chars_deleted        INTEGER DEFAULT 0,
  accepted_characters  INTEGER DEFAULT 0,
  model_name           TEXT,
  latency_ms           REAL DEFAULT 0,
  is_partial_accept    BOOLEAN DEFAULT FALSE,
  file_path            TEXT
);`,
  fileMetadata: `CREATE TABLE IF NOT EXISTS file_metadata (
  file_path                  TEXT PRIMARY KEY,
  language_id                TEXT,
  total_edits                INTEGER DEFAULT 0,
  total_accepted_completions INTEGER DEFAULT 0,
  total_accepted_characters  INTEGER DEFAULT 0
);`,
} as const;

/**
 * Normalise raw `TrackedEvent` objects into `EventRecord` rows.
 *
 * This is the INSERT step of the schema-normalisation pipeline: raw JSON
 * events are flattened into a uniform table shape so they can be queried
 * with SQL-style analytics.
 */
export function normaliseEvent(
  raw: {
    sessionId: string;
    timestamp: string;
    eventType: string;
    languageId: string;
    charsAdded?: number;
    charsDeleted?: number;
    acceptedCharacters?: number;
    modelName?: string;
    latencyMs?: number;
    isPartialAccept?: boolean;
    filePath?: string;
  },
  id: number,
): EventRecord {
  return {
    id,
    sessionId: raw.sessionId,
    timestamp: raw.timestamp,
    eventType: raw.eventType as EventRecord["eventType"],
    languageId: raw.languageId ?? "",
    charsAdded: raw.charsAdded ?? 0,
    charsDeleted: raw.charsDeleted ?? 0,
    acceptedCharacters: raw.acceptedCharacters ?? 0,
    modelName: raw.modelName ?? "",
    latencyMs: raw.latencyMs ?? 0,
    isPartialAccept: raw.isPartialAccept ?? false,
    filePath: raw.filePath ?? "",
  };
}

/**
 * Build session records by scanning a set of event records.
 *
 * Groups events by `sessionId` and derives `startedAt` / `endedAt` from the
 * earliest and latest timestamps in each group.
 */
export function buildSessionRecords(events: EventRecord[]): SessionRecord[] {
  const map = new Map<string, { min: string; max: string }>();
  for (const e of events) {
    const entry = map.get(e.sessionId);
    if (!entry) {
      map.set(e.sessionId, { min: e.timestamp, max: e.timestamp });
    } else {
      if (e.timestamp < entry.min) {
        entry.min = e.timestamp;
      }
      if (e.timestamp > entry.max) {
        entry.max = e.timestamp;
      }
    }
  }
  return Array.from(map.entries()).map(([sessionId, { min, max }]) => ({
    sessionId,
    startedAt: min,
    endedAt: max,
  }));
}

/**
 * Build file-metadata records by aggregating event records.
 */
export function buildFileMetadataRecords(events: EventRecord[]): FileMetadataRecord[] {
  const map = new Map<string, FileMetadataRecord>();
  for (const e of events) {
    if (!e.filePath) {
      continue;
    }
    const existing = map.get(e.filePath);
    if (!existing) {
      map.set(e.filePath, {
        filePath: e.filePath,
        languageId: e.languageId,
        totalEdits: e.eventType === "textChange" ? 1 : 0,
        totalAcceptedCompletions: e.eventType === "completionAccept" ? 1 : 0,
        totalAcceptedCharacters: e.acceptedCharacters,
      });
    } else {
      if (e.eventType === "textChange") {
        existing.totalEdits++;
      }
      if (e.eventType === "completionAccept") {
        existing.totalAcceptedCompletions++;
        existing.totalAcceptedCharacters += e.acceptedCharacters;
      }
    }
  }
  return Array.from(map.values());
}
