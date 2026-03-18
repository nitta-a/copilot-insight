/**
 * Log content parser — orchestrates JSON and plain-text/ccreq log parsing and
 * re-exports the public API for backward compatibility.
 *
 * Parsing is split into two focused sub-modules under `./parsers/`:
 *  - `jsonLogParser`  — handles structured JSON-embedded log lines
 *  - `textLogParser`  — handles `[fetchCompletions]`, `ccreq:`, and other
 *                       plain-text log lines
 *
 * Shared utilities (normalization, signal recording, session tracking, …) live
 * in `./parsers/parserHelpers`.
 */

import * as fsSync from "node:fs";
import * as readline from "node:readline";
import type { ParsingContext } from "../types";
import { tryParseJsonLogLine } from "./parsers/jsonLogParser";
import { parseTextLogLine } from "./parsers/textLogParser";

// Re-export public API from sub-modules so that existing consumers keep working
// without changing their import paths.
export {
  detectCommandUsage,
  extractThreadTitleFromPayload,
  incrementCount,
  incrementStatCount,
  isSubagentIntent,
  mergeCountByNormalizedModel,
  mergeStatsByNormalizedModel,
  normalizeContextSource,
  normalizeModelName,
} from "./parsers/parserHelpers";
export { processJsonEntry, tryParseJsonLogLine } from "./parsers/jsonLogParser";
export { parseTextLogLine } from "./parsers/textLogParser";

export function parseLogContent(content: string, ctx: ParsingContext): void {
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    if (!tryParseJsonLogLine(line, ctx)) {
      parseTextLogLine(line, ctx);
    }
  }
}

/**
 * Parse a log file line-by-line using a read stream to avoid loading the entire
 * file into memory. Returns `true` when parsing completed successfully, `false`
 * if the file could not be opened or a stream error occurred.
 */
export async function parseLogFile(filePath: string, ctx: ParsingContext): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const stream = fsSync.createReadStream(filePath, { encoding: "utf-8" });
    stream.on("error", () => resolve(false));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }
      if (!tryParseJsonLogLine(line, ctx)) {
        parseTextLogLine(line, ctx);
      }
    });
    rl.on("close", () => resolve(true));
    rl.on("error", () => resolve(false));
  });
}
