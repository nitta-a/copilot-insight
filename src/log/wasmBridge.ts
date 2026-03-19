/**
 * Wasm bridge — thin wrapper around the Wasm-compiled Rust parser.
 *
 * The bridge lazily loads the Wasm module (built by `wasm-pack`) and exposes a
 * safe TypeScript API that the existing `logContentParser` can call.  If the
 * Wasm module is not available (e.g. the user has not built it yet) every
 * function gracefully returns `null` so that the rest of the extension keeps
 * working.
 */

/**
 * Shape returned to callers after converting the Rust JSON output.
 * Field names use camelCase; the mapping from Rust snake_case is done inside
 * `parseLogChunkWasm`.
 */
export interface WasmParseResult {
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
}

/**
 * Raw JSON shape returned by the Rust `parse_log_chunk` function.
 * Uses snake_case to mirror the Rust `#[derive(Serialize)]` output.
 */
interface RawWasmResult {
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  total_shown: number;
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  total_accepted: number;
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  total_chat: number;
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  subagent_requests: number;
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  plan_count: number;
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  by_model_shown: Record<string, number>;
  // biome-ignore lint/style/useNamingConvention: mirrors Rust serde output
  by_model_accepted: Record<string, number>;
}

/**
 * Expected exports from the wasm-pack generated module.
 * We only declare the subset we actually use so that the bridge stays
 * decoupled from the full generated type declarations.
 */
interface WasmModule {
  // biome-ignore lint/style/useNamingConvention: matches wasm-bindgen export name
  parse_log_chunk(input: string): string;
}

/** Cached module reference — `undefined` means "not yet attempted". */
let wasmModule: WasmModule | null | undefined;

/**
 * Try to load the Wasm module.  Returns the module on success, or `null` when
 * the package has not been built yet (or any other import error occurs).
 *
 * The result is cached so that subsequent calls are essentially free.
 */
export async function loadWasmModule(): Promise<WasmModule | null> {
  if (wasmModule !== undefined) {
    return wasmModule;
  }

  try {
    // The wasm-pack output lives at <project-root>/wasm-parser/pkg.
    // We use `require()` instead of a static `import` because:
    //  1. The Wasm artefact may not exist yet (PoC / optional build step).
    //  2. TypeScript's NodeNext resolution would reject the bare-specifier
    //     relative path used by wasm-pack generated packages.
    //  3. Dynamic `require()` lets the extension start gracefully even when
    //     the Wasm package has not been compiled.
    const wasmPath = require.resolve("../../wasm-parser/pkg/wasm_parser");
    const mod = require(wasmPath) as WasmModule;
    wasmModule = mod;
    return wasmModule;
  } catch {
    wasmModule = null;
    return null;
  }
}

/**
 * Parse a raw log chunk using the Wasm parser.
 *
 * Returns a typed `WasmParseResult` on success, or `null` when the Wasm module
 * is unavailable or the parse itself fails.
 */
export async function parseLogChunkWasm(input: string): Promise<WasmParseResult | null> {
  const mod = await loadWasmModule();
  if (!mod) {
    return null;
  }

  try {
    const json = mod.parse_log_chunk(input);
    const raw = JSON.parse(json) as RawWasmResult;
    return {
      totalShown: raw.total_shown,
      totalAccepted: raw.total_accepted,
      totalChat: raw.total_chat,
      subagentRequests: raw.subagent_requests,
      planCount: raw.plan_count,
      byModelShown: raw.by_model_shown,
      byModelAccepted: raw.by_model_accepted,
    };
  } catch {
    return null;
  }
}

/**
 * Reset the cached module reference. Useful for testing or when the Wasm
 * artefact is rebuilt at runtime.
 */
export function resetWasmModule(): void {
  wasmModule = undefined;
}
