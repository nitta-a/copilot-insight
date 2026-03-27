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
import { performance } from "node:perf_hooks";
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
 * - New fields: `autonomousDurationMs`, `subagentLoops`, `executedPlanCount`,
 *   `browserToolsByType`, `errorsByType`.
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

  // Merge new NativeStats fields (default to zero in the Rust parser; non-zero
  // values are produced only when the addon has been updated to track them).
  if (native.autonomousDurationMs) {
    ctx.autonomousDurationMs += native.autonomousDurationMs;
  }
  if (native.subagentLoops) {
    ctx.subagentLoops += native.subagentLoops;
  }
  if (native.executedPlanCount) {
    ctx.executedPlanCount += native.executedPlanCount;
  }
  for (const [type_, count] of Object.entries(native.browserToolsByType ?? {})) {
    ctx.browserToolsByType.set(type_, (ctx.browserToolsByType.get(type_) ?? 0) + count);
    ctx.browserToolInvocations += count;
  }
  for (const [type_, count] of Object.entries(native.errorsByType ?? {})) {
    ctx.errorsByType.set(type_, (ctx.errorsByType.get(type_) ?? 0) + count);
    ctx.totalErrors += count;
  }

  // Merge token consumption stats.
  if (native.totalPromptTokens) {
    ctx.totalPromptTokens += native.totalPromptTokens;
  }
  if (native.totalCompletionTokens) {
    ctx.totalCompletionTokens += native.totalCompletionTokens;
  }
  for (const [model, tokenPair] of Object.entries(native.tokensByModel ?? {})) {
    const [pt, ct] = tokenPair as [number, number];
    const existing = ctx.tokensByModel.get(model) ?? { promptTokens: 0, completionTokens: 0 };
    existing.promptTokens += pt ?? 0;
    existing.completionTokens += ct ?? 0;
    ctx.tokensByModel.set(model, existing);
  }

  for (const signal of native.sessionSignals ?? []) {
    ctx.sessionSignals.push({
      eventType: "sessionSignal",
      sessionId: signal.sessionId || ctx.currentSessionId,
      languageId: "",
      timestamp: signal.timestamp,
      signalType: signal.signalType,
      actor: signal.actor,
      phase: signal.phase,
      intent: signal.intent,
      rawText: signal.rawText,
      modelName: signal.modelName,
      latencyMs: signal.latencyMs,
      success: signal.success,
    });
  }

  for (const [sessionId, state] of Object.entries(native.chatSessionStates ?? {})) {
    const existing = ctx.chatSessionStates.get(sessionId) ?? {
      sessionId,
      turnCount: 0,
      isAccepted: false,
    };
    existing.turnCount += state.turnCount;
    existing.isAccepted = existing.isAccepted || state.isAccepted;
    ctx.chatSessionStates.set(sessionId, existing);
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

/** Result of a single log-file parse pass. */
export interface ParseLogFileResult {
  /** Whether the file was successfully opened and parsed. */
  success: boolean;
  /** Wall-clock time taken to parse the file, in milliseconds. */
  elapsedMs: number;
  /** Whether the native Rust addon was used (`true`) or the JS readline fallback (`false`). */
  usedNative: boolean;
}

export interface ParseLogFileOptions {
  /** When set, skip to this byte offset before parsing (tail-read optimisation). */
  startByte?: number;
  /**
   * When `true`, always use the JS readline path even if the native addon is
   * available. Use this for log files whose content may trigger edge-case
   * behaviour in the Rust parser, such as exthost system logs.
   */
  forceJs?: boolean;
}

/**
 * Parse a log file, using the native addon when available for performance.
 *
 * When the native addon is available the file path is passed directly to
 * `parseLogFileNative`, which performs all file I/O in Rust without Node.js
 * reading the file. When the addon is absent the file is streamed line-by-line
 * via `readline` to keep memory usage bounded.
 *
 * When `opts.startByte` is provided the native path is skipped (it always reads
 * the whole file) and the JS readline path opens a stream starting at the given
 * byte offset.  The first (potentially partial) line is silently discarded by
 * the per-line parsers.
 *
 * Returns a `ParseLogFileResult` describing whether parsing succeeded, how long
 * it took (in ms), and which code path was used (native vs. JS).
 */
export async function parseLogFile(
  filePath: string,
  ctx: ParsingContext,
  opts?: ParseLogFileOptions,
): Promise<ParseLogFileResult> {
  const startMs = performance.now();
  // When a byte offset is supplied, or when forceJs is set, use the JS readline
  // path. The native addon always reads from the beginning of the file.
  const useNative = !opts?.startByte && !opts?.forceJs && loadNativeModule();
  if (useNative) {
    try {
      const nativeResult = parseLogFileNative(filePath);
      if (nativeResult) {
        mergeNativeResults(nativeResult, ctx);
        return { success: true, elapsedMs: performance.now() - startMs, usedNative: true };
      }
    } catch {
      // Intentionally silent: file-not-found, permission errors, and unexpected
      // parse failures are treated as "native addon unavailable" so the caller
      // receives `false` and can decide how to proceed.  Logging is omitted
      // here because individual file failures are normal during log-dir scans
      // (e.g. files removed while scanning).
      return { success: false, elapsedMs: performance.now() - startMs, usedNative: true };
    }
  }

  // Fallback: readline streaming (memory-efficient, full detail).
  return new Promise<ParseLogFileResult>((resolve) => {
    const streamOpts: { encoding: BufferEncoding; start?: number } = { encoding: "utf-8" };
    if (opts?.startByte) {
      streamOpts.start = opts.startByte;
    }
    const stream = fsSync.createReadStream(filePath, streamOpts);
    stream.on("error", () => resolve({ success: false, elapsedMs: performance.now() - startMs, usedNative: false }));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }
      if (!tryParseJsonLogLine(line, ctx)) {
        parseTextLogLine(line, ctx);
      }
    });
    rl.on("close", () => resolve({ success: true, elapsedMs: performance.now() - startMs, usedNative: false }));
    rl.on("error", () => resolve({ success: false, elapsedMs: performance.now() - startMs, usedNative: false }));
  });
}
