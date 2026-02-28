import * as fs from "fs";
import * as path from "path";
import type { TrackedEvent } from "./eventSchema";

/**
 * Append-only JSON Lines storage for tracked events.
 *
 * Each event is serialised as a single JSON object terminated by `\n` and
 * appended to a date-partitioned file under the extension's
 * `globalStoragePath`.  This keeps file sizes manageable and makes it easy to
 * prune old data.
 *
 * Directory layout:
 * ```
 * <globalStoragePath>/events/
 *   2024-06-01.jsonl
 *   2024-06-02.jsonl
 *   …
 * ```
 */
export class EventStorage {
  private readonly _eventsDir: string;
  private _disposed = false;

  /**
   * @param globalStoragePath  `context.globalStorageUri.fsPath` — the
   *   extension-private directory that VS Code guarantees exists (or can be
   *   created) for this extension.
   */
  constructor(globalStoragePath: string) {
    this._eventsDir = path.join(globalStoragePath, "events");
  }

  /** Persist a single event.  Silently ignores write errors to avoid
   *  disrupting the user's editing session. */
  append(event: TrackedEvent): void {
    if (this._disposed) {
      return;
    }
    try {
      fs.mkdirSync(this._eventsDir, { recursive: true });
      const dateKey = event.timestamp.substring(0, 10) || "unknown";
      const filePath = path.join(this._eventsDir, `${dateKey}.jsonl`);
      fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf-8");
    } catch {
      // Silently skip — preserve the extension's error-handling convention.
    }
  }

  /**
   * Read all events stored for a given date (YYYY-MM-DD).
   * Returns an empty array when the file does not exist or is unreadable.
   */
  readByDate(dateKey: string): TrackedEvent[] {
    const filePath = path.join(this._eventsDir, `${dateKey}.jsonl`);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const events: TrackedEvent[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          events.push(JSON.parse(line) as TrackedEvent);
        } catch {
          // skip malformed lines
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  /** List all date keys (YYYY-MM-DD) for which event files exist. */
  listDates(): string[] {
    try {
      return fs
        .readdirSync(this._eventsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.replace(".jsonl", ""))
        .sort();
    } catch {
      return [];
    }
  }

  /** Stop accepting new events. */
  dispose(): void {
    this._disposed = true;
  }
}
