/**
 * CLI log reader — discovers and parses GitHub Copilot CLI session logs stored
 * as JSONL files under `~/.copilot/session-state/<uuid>/events.jsonl`.
 *
 * Each session file contains one JSON event per line.  The events relevant to
 * usage statistics are:
 *
 *   {"type":"session.start","data":{"startTime":"2026-03-14T04:02:16.445Z", ...}}
 *   {"type":"user.message","data":{...}}
 *   {"type":"assistant.message","data":{"outputTokens": 927, ...}}
 *
 * Errors in individual files are silently swallowed (same convention as the
 * VS Code log parsers) so that a corrupt or partially written file does not
 * abort the entire scan.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CliDateStat } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CliStats {
  /** Per-date CLI interaction statistics (prompts + output tokens). */
  byDate: Map<string, CliDateStat>;
  /** Total number of CLI prompt interactions across all scanned sessions. */
  totalInteractions: number;
  /** Number of assistant-turn interactions attributed to each model name. */
  interactionsByModel: Map<string, number>;
}

/**
 * Scan the Copilot CLI session-state directory and return aggregated usage
 * statistics keyed by ISO date string (YYYY-MM-DD).
 *
 * @param cliLogDir  Root directory to scan.  Defaults to
 *                   `~/.copilot/session-state/`.  Pass an explicit path (e.g.
 *                   from the `copilot-insight.cliLogPath` VS Code setting) to
 *                   override auto-discovery.
 */
export async function readCliStats(cliLogDir?: string, defaultModel = "Copilot CLI"): Promise<CliStats> {
  const rootDir = cliLogDir?.trim() ? cliLogDir.trim() : path.join(os.homedir(), ".copilot", "session-state");

  const byDate = new Map<string, CliDateStat>();
  const interactionsByModel = new Map<string, number>();
  let totalInteractions = 0;

  let sessionDirs: string[];
  try {
    const entries = await fs.readdir(rootDir);
    sessionDirs = entries.map((e) => path.join(rootDir, e));
  } catch {
    // Directory does not exist — CLI not installed or never used.
    return { byDate, totalInteractions, interactionsByModel };
  }

  for (const sessionDir of sessionDirs) {
    const eventsPath = path.join(sessionDir, "events.jsonl");
    try {
      const raw = await fs.readFile(eventsPath, "utf8");
      const result = parseEventsJsonl(raw, defaultModel);

      // Merge per-date stats.
      for (const [dateKey, stat] of result.byDate) {
        const existing = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
        byDate.set(dateKey, {
          prompts: existing.prompts + stat.prompts,
          outputTokens: existing.outputTokens + stat.outputTokens,
        });
      }
      totalInteractions += result.totalInteractions;
      // Merge per-model counts.
      for (const [model, count] of result.interactionsByModel) {
        interactionsByModel.set(model, (interactionsByModel.get(model) ?? 0) + count);
      }
    } catch {
      // Skip unreadable or missing files.
    }
  }

  return { byDate, totalInteractions, interactionsByModel };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParseResult {
  byDate: Map<string, CliDateStat>;
  totalInteractions: number;
  interactionsByModel: Map<string, number>;
}

/**
 * Parse a single `events.jsonl` file content.
 *
 * Date key is derived from `session.start.data.startTime`.  If no
 * `session.start` event is found the date falls back to today.
 */
export function parseEventsJsonl(content: string, defaultModel = "Copilot CLI"): ParseResult {
  const byDate = new Map<string, CliDateStat>();
  const interactionsByModel = new Map<string, number>();
  let totalInteractions = 0;

  // Derive today's date as a fallback (YYYY-MM-DD in UTC).
  const todayKey = new Date().toISOString().substring(0, 10);
  let dateKey = todayKey;
  // Model for the current session (from session.start or overridden per turn).
  let sessionModel = defaultModel;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = event.type as string | undefined;
    if (!type) {
      continue;
    }

    if (type === "session.start") {
      // Extract YYYY-MM-DD from the session start timestamp.
      const data = event.data as Record<string, unknown> | undefined;
      const startTime = data?.startTime as string | undefined;
      if (startTime && /^\d{4}-\d{2}-\d{2}/.test(startTime)) {
        dateKey = startTime.substring(0, 10);
      }
      // Extract optional session-level model name (e.g. "claude-opus-4.6").
      const model = data?.model as string | undefined;
      sessionModel = model?.trim() || defaultModel;
      continue;
    }

    if (type === "user.message") {
      const current = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
      byDate.set(dateKey, { ...current, prompts: current.prompts + 1 });
      totalInteractions++;
      continue;
    }

    if (type === "assistant.message") {
      const data = event.data as Record<string, unknown> | undefined;
      const outputTokens = typeof data?.outputTokens === "number" ? data.outputTokens : 0;
      if (outputTokens > 0) {
        const current = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
        byDate.set(dateKey, { ...current, outputTokens: current.outputTokens + outputTokens });
      }
      // Attribute this turn to a model (prefer per-message field over session model).
      const turnModel = (data?.model as string | undefined)?.trim() || sessionModel;
      interactionsByModel.set(turnModel, (interactionsByModel.get(turnModel) ?? 0) + 1);
      continue;
    }
  }

  return { byDate, totalInteractions, interactionsByModel };
}
