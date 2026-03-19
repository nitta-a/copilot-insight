/**
 * Native bridge — thin wrapper around the NAPI-RS compiled native addon.
 *
 * The bridge lazily loads the `.node` module (built by `npm run build:native`)
 * and exposes a safe TypeScript API that `logContentParser` can call. If the
 * native module is not available (e.g. the user has not built it yet) every
 * function gracefully returns `null` so that the rest of the extension keeps
 * working with the JS readline fallback.
 */

/**
 * Shape returned to callers from the native module.
 * Field names use camelCase, which NAPI-RS produces automatically from the
 * Rust snake_case field names.
 */
export interface NativeParseResult {
  /** Number of inline-completion suggestions shown to the user. */
  totalShown: number;
  /** Number of inline-completion suggestions accepted by the user. */
  totalAccepted: number;
  /** Number of chat requests detected. */
  totalChat: number;
  /** Number of subagent-initiated requests detected. */
  subagentRequests: number;
  /** Number of agent plan-proposal events detected. */
  planCount: number;
  /** Per-model count of shown inline completions (model name → count). */
  byModelShown: Record<string, number>;
  /** Per-model count of accepted inline completions (model name → count). */
  byModelAccepted: Record<string, number>;
  /** Per-date shown/accepted counts (date key "YYYY-MM-DD" → {shown, accepted}). */
  byDate: Record<string, { shown: number; accepted: number }>;
  /** Per-hour event counts (hour key "HH" → count). */
  byHour: Record<string, number>;
  /** Raw inline-completion latency values in milliseconds. */
  latencies: number[];
  /** Per context-source occurrence counts. */
  byContextSource: Record<string, number>;
}

/**
 * Expected exports from the NAPI-RS generated module.
 * We only declare the subset we actually use so that the bridge stays
 * decoupled from the full generated type declarations.
 */
interface NativeModule {
  parseLogChunk(input: string): NativeParseResult;
  parseLogFileNative(path: string): NativeParseResult;
}

/** Cached module reference — `undefined` means "not yet attempted". */
let nativeModule: NativeModule | null | undefined;

/**
 * Try to load the native `.node` module. Returns the module on success, or
 * `null` when the package has not been built yet (or any other import error
 * occurs).
 *
 * The result is cached so that subsequent calls are essentially free.
 */
export function loadNativeModule(): NativeModule | null {
  if (nativeModule !== undefined) {
    return nativeModule;
  }

  try {
    // The NAPI-RS output lives at <project-root>/native-parser/.
    // We use `require()` instead of a static `import` because:
    //  1. The `.node` artefact may not exist yet (optional build step).
    //  2. Dynamic `require()` lets the extension start gracefully even when
    //     the native addon has not been compiled.
    const nativePath = require.resolve("../../native-parser/");
    const mod = require(nativePath) as NativeModule;
    nativeModule = mod;
    return nativeModule;
  } catch {
    nativeModule = null;
    return null;
  }
}

/**
 * Parse a raw log chunk using the native Rust parser.
 *
 * Returns a typed `NativeParseResult` on success, or `null` when the native
 * module is unavailable or the parse itself fails.
 */
export function parseLogChunkNative(input: string): NativeParseResult | null {
  const mod = loadNativeModule();
  if (!mod) {
    return null;
  }

  try {
    return mod.parseLogChunk(input);
  } catch {
    return null;
  }
}

/**
 * Parse a log file at the given `path` using the native Rust parser.
 *
 * File I/O is performed entirely in Rust — Node.js does not read the file.
 * Returns a typed `NativeParseResult` on success, or `null` when the native
 * module is unavailable or the file cannot be opened.
 */
export function parseLogFileNative(path: string): NativeParseResult | null {
  const mod = loadNativeModule();
  if (!mod) {
    return null;
  }

  try {
    return mod.parseLogFileNative(path);
  } catch {
    return null;
  }
}

/**
 * Reset the cached module reference. Useful for testing or when the native
 * artefact is rebuilt at runtime.
 */
export function resetNativeModule(): void {
  nativeModule = undefined;
}
