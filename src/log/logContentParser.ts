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
 *
 * When the optional native addon is available (built via `npm run build:native`),
 * both `parseLogContent` and `parseLogFile` delegate bulk counting to the
 * Rust-compiled functions for better performance.  `parseLogFile` passes the
 * file path directly to the native addon so that Rust performs all file I/O.
 * When the addon is absent the pipeline falls back to the existing JS
 * line-by-line parsers transparently.
 */

import * as fsSync from "node:fs";
import * as readline from "node:readline";
import type { ParsingContext } from "../types";
import { tryParseJsonLogLine } from "./parsers/jsonLogParser";
import { parseTextLogLine } from "./parsers/textLogParser";
import type { NativeParseResult } from "./nativeBridge";
import { loadNativeModule, parseLogChunkNative, parseLogFileNative } from "./nativeBridge";

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

/**
 * Merge aggregated counts returned by the native parser into a `ParsingContext`.
 *
 * This is an **additive** merge: the native counts for the current chunk are
 * added on top of any counts already accumulated from previously processed
 * files/chunks.
 *
 * The following fields are merged:
 * - Core counters: `totalShown`, `totalAccepted`, `totalChat`,
 *   `subagentRequests`, `planCount`.
 * - Per-model maps: `byModel` (shown + accepted counts).
 * - Per-date map: `byDate` (shown + accepted counts per date key).
 * - Per-hour map: `byHour` (event counts per hour key).
 * - Latency array: `latencies` (raw millisecond values appended).
 * - Context-source map: `byContextSource` (occurrence counts per source).
 */
function mergeNativeResults(native: NativeParseResult, ctx: ParsingContext): void {
  ctx.totalShown += native.totalShown;
  ctx.totalAccepted += native.totalAccepted;
  ctx.totalChat += native.totalChat;
  ctx.subagentRequests += native.subagentRequests;
  ctx.planCount += native.planCount;

  for (const [model, count] of Object.entries(native.byModelShown)) {
    const existing = ctx.byModel.get(model) ?? { shown: 0, accepted: 0 };
    existing.shown += count;
    ctx.byModel.set(model, existing);
  }

  for (const [model, count] of Object.entries(native.byModelAccepted)) {
    const existing = ctx.byModel.get(model) ?? { shown: 0, accepted: 0 };
    existing.accepted += count;
    ctx.byModel.set(model, existing);
  }

  for (const [date, stat] of Object.entries(native.byDate)) {
    const existing = ctx.byDate.get(date) ?? { shown: 0, accepted: 0 };
    existing.shown += stat.shown;
    existing.accepted += stat.accepted;
    ctx.byDate.set(date, existing);
  }

  for (const [hour, count] of Object.entries(native.byHour)) {
    ctx.byHour.set(hour, (ctx.byHour.get(hour) ?? 0) + count);
  }

  if (native.latencies.length > 0) {
    for (const lat of native.latencies) {
      ctx.latencies.push(lat);
    }
  }

  for (const [src, count] of Object.entries(native.byContextSource)) {
    ctx.byContextSource.set(src, (ctx.byContextSource.get(src) ?? 0) + count);
  }

  // Merge context-richness reference-count histogram contributed by the Rust parser.
  // The Rust path and JS path track different granularities (per-request vs per-session),
  // but both increment the same bucket keys ("0"/"1"/"2"/"3"/"4+") so the histograms
  // can be additively merged when both paths are used for the same corpus.
  if (native.contextRichness) {
    for (const [bucket, stat] of Object.entries(native.contextRichness.byRefCount)) {
      const existing = ctx.nativeRefCountBuckets?.get(bucket) ?? { shown: 0, accepted: 0 };
      existing.shown += stat.shown;
      existing.accepted += stat.accepted;
      if (!ctx.nativeRefCountBuckets) {
        ctx.nativeRefCountBuckets = new Map();
      }
      ctx.nativeRefCountBuckets.set(bucket, existing);
    }
  }
}

/**
 * Parse log content from an in-memory string.
 *
 * Attempts native bulk parsing first for both the core counters (`totalShown`,
 * `totalAccepted`, `totalChat`, `subagentRequests`, `planCount`, `byModel`)
 * and the detailed metrics (`byDate`, `byHour`, `latencies`,
 * `byContextSource`).
 * When the native addon is unavailable or parsing fails, falls back to the
 * existing JS line-by-line parsers which populate all of the above fields
 * plus session-signal fields not tracked by the native path.
 */
export async function parseLogContent(content: string, ctx: ParsingContext): Promise<void> {
  // Fast path: try the native bulk parser for core counters.
  const nativeResult = parseLogChunkNative(content);
  if (nativeResult) {
    mergeNativeResults(nativeResult, ctx);
    return;
  }

  // Fallback: JS line-by-line parsing (also populates date/hour/latency fields).
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
 * Parse a log file, using the native addon when available for performance.
 *
 * When the native addon is available the file path is passed directly to
 * `parseLogFileNative`, which performs all file I/O in Rust without Node.js
 * reading the file. When the addon is absent the file is streamed line-by-line
 * via `readline` to keep memory usage bounded.
 *
 * Returns `true` when parsing completed successfully, `false` if the file
 * could not be opened or a stream/parse error occurred.
 */
export async function parseLogFile(filePath: string, ctx: ParsingContext): Promise<boolean> {
  // Check if the native addon is available (cheap after the first call — result is cached).
  if (loadNativeModule()) {
    try {
      const nativeResult = parseLogFileNative(filePath);
      if (nativeResult) {
        mergeNativeResults(nativeResult, ctx);
        return true;
      }
    } catch {
      // Intentionally silent: file-not-found, permission errors, and unexpected
      // parse failures are treated as "native addon unavailable" so the caller
      // receives `false` and can decide how to proceed.  Logging is omitted
      // here because individual file failures are normal during log-dir scans
      // (e.g. files removed while scanning).
      return false;
    }
  }

  // Fallback: readline streaming (memory-efficient, full detail).
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
