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
let nativeModuleLoader: (() => NativeModule) | undefined;

/**
 * Try to load the native `.node` module. Returns the module on success, or
 * `null` when the package has not been built yet (or any other import error
 * occurs).
 *
 * The result is cached so that subsequent calls are essentially free.
 */
let nativeLoadError: string | undefined;
let nativeLoadWarningShown = false;

const NATIVE_LOAD_WARNING =
  "Rust native parser failed to load. Falling back to slow JS parser. Please run 'npm run build:native'.";

/**
 * Returns the error message from the last failed `loadNativeModule()` call,
 * or `undefined` if the module loaded successfully or has not been attempted.
 */
export function getNativeLoadError(): string | undefined {
  return nativeLoadError;
}

export function setNativeModuleLoaderForTesting(loader: (() => NativeModule) | undefined): void {
  nativeModuleLoader = loader;
  resetNativeModule();
}

function warnNativeLoadFailureOnce(errorMessage: string): void {
  if (nativeLoadWarningShown) {
    return;
  }

  nativeLoadWarningShown = true;
  const detailedMessage = `${NATIVE_LOAD_WARNING} ${errorMessage}`;
  console.warn(detailedMessage);

  try {
    const { getLogChannel } = require("./logChannel") as typeof import("./logChannel");
    getLogChannel().appendLine(`[native-parser] ${detailedMessage}`);
  } catch {
    // Best-effort only: warning should not break non-extension contexts.
  }

  try {
    const vscode = require("vscode") as typeof import("vscode");
    void vscode.window.showWarningMessage(NATIVE_LOAD_WARNING);
  } catch {
    // Best-effort only: warning should not break non-extension contexts.
  }
}

export function loadNativeModule(): NativeModule | null {
  if (nativeModule !== undefined) {
    return nativeModule;
  }

  try {
    const mod =
      nativeModuleLoader?.() ??
      (() => {
        // The NAPI-RS output lives at <project-root>/native-parser/.
        // From dist/extension.js (one level below the project root) the correct
        // relative path is ../native-parser/, not ../../native-parser/.
        // We use `require()` instead of a static `import` because:
        //  1. The `.node` artefact may not exist yet (optional build step).
        //  2. Dynamic `require()` lets the extension start gracefully even when
        //     the native addon has not been compiled.
        const nativePath = require.resolve("../native-parser/");
        return require(nativePath) as NativeModule;
      })();
    nativeLoadError = undefined;
    nativeModule = mod;
    return nativeModule;
  } catch (err) {
    nativeLoadError = err instanceof Error ? err.message : String(err);
    warnNativeLoadFailureOnce(nativeLoadError);
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
  nativeLoadError = undefined;
  nativeLoadWarningShown = false;
}
