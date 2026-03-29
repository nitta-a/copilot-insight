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
export interface NativeContextRichness {
  /** Total character count of all prompt_text fields encountered. */
  totalPromptChars: number;
  /** Number of log entries that carried a non-empty prompt_text field. */
  promptCount: number;
}

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
  /** Context-richness metrics extracted from reference-count and prompt-text fields. */
  contextRichness: NativeContextRichness;
  /** Cumulative autonomous-action duration in milliseconds (f64 for JS number compat). */
  autonomousDurationMs: number;
  /** Number of completed agentic (ToolCallingLoop) episodes. */
  subagentLoops: number;
  /** Number of agent plans that were followed by an edit / patch action. */
  executedPlanCount: number;
  /** Browser-tool events grouped by detected action / subtype. */
  browserToolsByType: Record<string, number>;
  /** Error events grouped by detected error type. */
  errorsByType: Record<string, number>;
  /** Total prompt tokens consumed across all log entries that report token counts. */
  totalPromptTokens: number;
  /** Total completion tokens generated across all log entries that report token counts. */
  totalCompletionTokens: number;
  /**
   * Per-model prompt and completion token totals.
   * Each value is a two-element array: `[promptTokens, completionTokens]`.
   */
  tokensByModel: Record<string, number[]>;
  /** Total non-empty log lines processed by the parser (diagnostic). */
  linesParsed: number;
  /** Lines handled by the JSON parsing path; `linesParsed - jsonLines` = plain-text lines. */
  jsonLines: number;
  /** Per-model count of all chat and agentic requests (normalised model name → count). */
  byChatModel: Record<string, number>;
  /** Per-model count of subagent-initiated requests only (agentic intents). */
  subagentByModel: Record<string, number>;
  /** Per-model accumulated latency for agentic-intent requests (ms); proxy for autonomous duration. */
  autonomousDurationByModel: Record<string, number>;
  /** Per-date count of chat and agentic requests ("YYYY-MM-DD" → count). */
  chatByDate: Record<string, number>;
  /** Completion finish-reason distribution ("[streamChoices] finish reason: XXX"). */
  finishReasonCounts: Record<string, number>;
  /** Number of agentic (ToolCallingLoop) episodes that were started. */
  subagentLoopsStarted: number;
  /** Number of inline completions rejected by the user (AbortError in logs). */
  totalRejected: number;
  /** Per-model count of agentic episodes that completed. */
  loopsCompletedByModel: Record<string, number>;
  /** Per-model total agentic actions across all completed loops. */
  totalLoopActionsByModel: Record<string, number>;
  /** Per-model count of agentic episodes that were started. */
  loopsStartedByModel: Record<string, number>;
}

/**
 * Data shape passed to the native `generateMarkdownReportNative` function.
 * All fields map 1-to-1 to the Rust `ReportInput` struct fields.
 */
export interface NativeReportInput {
  totalShown: number;
  totalAccepted: number;
  totalChat: number;
  totalErrors: number;
  logFilesFound: number;
  avgLatencyMs: number;
  subagentRequests: number;
  autonomousDurationMs: number;
  agenticRatio: number;
  subagentLoops: number;
  subagentLoopsStarted: number;
  completionRate: number;
  planCount: number;
  executedPlanCount: number;
  userChoicesInPlan: number;
  browserToolsByType: Record<string, number>;
  pluginOrSkillByName: Record<string, number>;
  memoryManagementCount: number;
  memoryManagementByType: Record<string, number>;
  agentDebugEvents: number;
  agentDebugByType: Record<string, number>;
  subagentByModel: Record<string, number>;
  autonomousDurationByModel: Record<string, number>;
  byChatModel: Record<string, number>;
  minDate: string;
  maxDate: string;
  typingMinutesSaved: number;
  agenticMinutesSaved: number;
  projectName: string;
  errorsByType: Record<string, number>;
}

/**
 * Expected exports from the NAPI-RS generated module.
 * We only declare the subset we actually use so that the bridge stays
 * decoupled from the full generated type declarations.
 */
interface NativeModule {
  parseLogChunk(input: string): NativeParseResult;
  parseLogFileNative(path: string): NativeParseResult;
  generateMarkdownReportNative(input: NativeReportInput, period: string): string;
}

/** Cached module reference — `undefined` means "not yet attempted". */
let nativeModule: NativeModule | null | undefined;

/**
 * Human-readable reason why `loadNativeModule()` returned `null`.
 * `null` means the module loaded successfully or has not been attempted yet.
 */
let nativeLoadError: string | null = null;

/**
 * Return the error message from the last failed `loadNativeModule()` call,
 * or `null` when the native addon loaded successfully or has not been tried.
 */
export function getNativeLoadError(): string | null {
  return nativeLoadError;
}

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
    // Use a direct `require` of the package path rather than `require.resolve`.
    // Some environments can resolve the directory to the package.json file
    // which would make `require(pathToPackageJson)` return the JSON object
    // instead of the compiled addon. Requiring the package path lets Node's
    // module resolver pick the package `main` entry or `index.js` correctly.
    const mod = require("../../native-parser") as NativeModule;
    nativeModule = mod;
    nativeLoadError = null;
    return nativeModule;
  } catch (err) {
    nativeLoadError = err instanceof Error ? err.message : String(err);
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
 * Generate a Markdown report from the provided `NativeReportInput` using the
 * native Rust implementation.
 *
 * Returns the report string on success, or `null` when the native module is
 * unavailable or report generation fails.
 */
export function generateMarkdownReportNative(input: NativeReportInput, period: string): string | null {
  const mod = loadNativeModule();
  if (!mod) {
    return null;
  }

  try {
    return mod.generateMarkdownReportNative(input, period);
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
