use napi_derive::napi;
use std::collections::HashMap;

/// Per-date shown/accepted counts returned as a NAPI-RS object.
#[napi(object)]
#[derive(Default, Clone)]
pub struct NativeDateStat {
    pub shown: u32,
    pub accepted: u32,
}

/// Aggregated context-richness metrics produced by the native parser.
#[napi(object)]
#[derive(Default)]
pub struct NativeContextRichness {
    /// Total character count of all prompt_text fields encountered (for avg prompt length).
    pub total_prompt_chars: u32,
    /// Number of log entries that carried a non-empty prompt_text field.
    pub prompt_count: u32,
}

/// Aggregated statistics produced by parsing a log file or chunk.
/// Field names are automatically converted from snake_case to camelCase
/// by NAPI-RS when exposed to JavaScript.
#[napi(object)]
pub struct NativeStats {
    /// Number of inline-completion suggestions shown to the user.
    pub total_shown: u32,
    /// Number of inline-completion suggestions accepted by the user.
    pub total_accepted: u32,
    /// Number of chat requests made.
    pub total_chat: u32,
    /// Number of subagent-initiated requests detected.
    pub subagent_requests: u32,
    /// Number of agent plan-proposal events detected.
    pub plan_count: u32,
    /// Per-model count of shown inline completions (model name → count).
    pub by_model_shown: HashMap<String, u32>,
    /// Per-model count of accepted inline completions (model name → count).
    pub by_model_accepted: HashMap<String, u32>,
    /// Per-date shown/accepted counts (date key "YYYY-MM-DD" → NativeDateStat).
    pub by_date: HashMap<String, NativeDateStat>,
    /// Per-hour event counts (hour key "HH" → count).
    pub by_hour: HashMap<String, u32>,
    /// Raw inline-completion latency values in milliseconds.
    pub latencies: Vec<u32>,
    /// Per context-source occurrence counts.
    pub by_context_source: HashMap<String, u32>,
    /// Context-richness metrics extracted from reference-count and prompt-text fields.
    pub context_richness: NativeContextRichness,
    /// Cumulative autonomous-action duration in milliseconds.
    /// Uses f64 (rather than u64) for seamless JavaScript number interop.
    pub autonomous_duration_ms: f64,
    /// Number of completed agentic (ToolCallingLoop) episodes.
    pub subagent_loops: u32,
    /// Number of agent plans that were followed by an edit / patch action.
    pub executed_plan_count: u32,
    /// Browser-tool events grouped by detected action / subtype.
    pub browser_tools_by_type: HashMap<String, u32>,
    /// Error events grouped by detected error type.
    pub errors_by_type: HashMap<String, u32>,
    /// Total prompt tokens consumed across all log entries that report token counts.
    pub total_prompt_tokens: u32,
    /// Total completion tokens generated across all log entries that report token counts.
    pub total_completion_tokens: u32,
    /// Per-model prompt and completion token totals.
    /// Keys are normalised model names; values are `[promptTokens, completionTokens]`.
    pub tokens_by_model: HashMap<String, Vec<u32>>,
    /// Total number of non-empty log lines processed by the parser.
    /// Exposed to JavaScript for diagnostic logging (e.g. "[TIMING] file [native]").
    pub lines_parsed: u32,
    /// Number of lines handled by the JSON parsing path.
    /// `lines_parsed - json_lines` gives the count of plain-text path lines.
    pub json_lines: u32,
    /// Per-model count of all chat and agentic requests (normalised model name → count).
    pub by_chat_model: HashMap<String, u32>,
    /// Per-model count of subagent-initiated requests only (agentic intents).
    pub subagent_by_model: HashMap<String, u32>,
    /// Per-model accumulated latency for agentic-intent requests (milliseconds).
    /// Used as a proxy for per-model autonomous duration.
    pub autonomous_duration_by_model: HashMap<String, f64>,
    /// Per-date count of chat and agentic requests ("YYYY-MM-DD" → count).
    pub chat_by_date: HashMap<String, u32>,
    /// Completion finish-reason distribution ("[streamChoices] finish reason: XXX").
    pub finish_reason_counts: HashMap<String, u32>,
    /// Number of agentic (ToolCallingLoop) episodes that were started.
    pub subagent_loops_started: u32,
    /// Number of inline completions rejected by the user (AbortError in logs).
    pub total_rejected: u32,
    /// Per-model count of agentic (ToolCallingLoop) episodes that completed.
    pub loops_completed_by_model: HashMap<String, u32>,
    /// Per-model total number of agentic actions executed across all completed loops.
    pub total_loop_actions_by_model: HashMap<String, u32>,
    /// Per-model count of agentic (ToolCallingLoop) episodes that were started.
    pub loops_started_by_model: HashMap<String, u32>,
    /// Per-date count of agentic (ToolCallingLoop) episodes that were started ("YYYY-MM-DD" → count).
    pub loops_started_by_date: HashMap<String, u32>,
    /// Per-date count of agentic (ToolCallingLoop) episodes that completed ("YYYY-MM-DD" → count).
    pub loops_completed_by_date: HashMap<String, u32>,
    /// Per-date total number of agentic actions executed across all completed loops.
    pub total_loop_actions_by_date: HashMap<String, u32>,
    /// Per-date cumulative autonomous-action duration in milliseconds.
    /// Uses f64 (rather than u64) for seamless JavaScript number interop.
    pub autonomous_duration_by_date: HashMap<String, f64>,
}

/// All data required to produce a Markdown report.
///
/// Designed as a separate struct from `NativeStats` so that callers can
/// populate only the fields they need without having to supply every field
/// that `NativeStats` carries from the log-parsing path.
/// Field names are automatically camel-cased by NAPI-RS.
#[napi(object)]
pub struct ReportInput {
    // ── Core inline-completion counters ─────────────────────────────────────
    pub total_shown: u32,
    pub total_accepted: u32,
    pub total_chat: u32,
    pub total_errors: u32,
    pub log_files_found: u32,
    pub avg_latency_ms: f64,
    // ── Agentic / subagent counters ──────────────────────────────────────────
    pub subagent_requests: u32,
    pub autonomous_duration_ms: f64,
    pub agentic_ratio: f64,
    pub subagent_loops: u32,
    pub subagent_loops_started: u32,
    pub completion_rate: f64,
    // ── Planning counters ────────────────────────────────────────────────────
    pub plan_count: u32,
    pub executed_plan_count: u32,
    pub user_choices_in_plan: u32,
    // ── VS Code 1.110 feature-signal breakdowns ──────────────────────────────
    pub browser_tools_by_type: HashMap<String, u32>,
    pub plugin_or_skill_by_name: HashMap<String, u32>,
    /// Total number of session-memory / compact events (array length on TS side).
    pub memory_management_count: u32,
    pub memory_management_by_type: HashMap<String, u32>,
    pub agent_debug_events: u32,
    pub agent_debug_by_type: HashMap<String, u32>,
    // ── Model-efficiency breakdown ───────────────────────────────────────────
    pub subagent_by_model: HashMap<String, u32>,
    /// Per-model autonomous duration in milliseconds (f64 for JS number compat).
    pub autonomous_duration_by_model: HashMap<String, f64>,
    pub by_chat_model: HashMap<String, u32>,
    // ── Date-range metadata (used for the report header) ────────────────────
    pub min_date: String,
    pub max_date: String,
    // ── Pre-computed ROI values ──────────────────────────────────────────────
    /// Pre-computed typing minutes saved (0 → derived from total_accepted in Rust).
    pub typing_minutes_saved: f64,
    /// Pre-computed agentic minutes saved (0 → derived from autonomous_duration_ms in Rust).
    pub agentic_minutes_saved: f64,
    // ── Report metadata ──────────────────────────────────────────────────────
    pub project_name: String,
    pub errors_by_type: HashMap<String, u32>,
}
