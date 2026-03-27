#![deny(clippy::all)]

use napi_derive::napi;
use serde::Deserialize;
use std::collections::HashMap;
use std::fmt::Write as FmtWrite;
use std::fs::File;
use std::io::{BufRead, BufReader};

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

/// Session-level signal event returned from the native parser.
#[napi(object)]
#[derive(Clone, Default)]
pub struct NativeSessionSignal {
    pub timestamp: String,
    pub signal_type: String,
    pub actor: String,
    pub phase: String,
    pub intent: String,
    pub raw_text: String,
    pub model_name: String,
    pub latency_ms: u32,
    pub success: bool,
    pub session_id: String,
}

/// Per-chat-session turn/acceptance state extracted from JSON logs.
#[napi(object)]
#[derive(Clone, Default)]
pub struct NativeChatSessionState {
    pub session_id: String,
    pub turn_count: u32,
    pub is_accepted: bool,
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
    /// Session-level signal events extracted from JSON and plain-text logs.
    pub session_signals: Vec<NativeSessionSignal>,
    /// Per-chat-session turn/acceptance state keyed by session identifier.
    pub chat_session_states: HashMap<String, NativeChatSessionState>,
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

/// Minimal shape used to deserialise Copilot JSON log entries.
/// Only the fields we aggregate are declared; unknown fields are ignored.
#[derive(Deserialize)]
struct LogEntry {
    event: Option<String>,
    #[serde(rename = "eventName")]
    event_name: Option<String>,
    model: Option<String>,
    #[serde(rename = "modelId")]
    model_id: Option<String>,
    /// Some log sources use snake_case.
    model_name: Option<String>,
    #[serde(rename = "engineId")]
    engine_id: Option<String>,
    #[serde(rename = "engineName")]
    engine_name: Option<String>,
    engine: Option<String>,
    /// ISO-8601 timestamp of the event (also accepted as "timestamp").
    #[serde(alias = "timestamp")]
    time: Option<String>,
    /// Inline-completion latency in milliseconds.
    #[serde(rename = "latencyMs")]
    latency_ms: Option<u32>,
    /// Context source identifier (e.g. "vscodePrompt", "activeDocument").
    context_source: Option<String>,
    /// User prompt text for prompt-length tracking.
    #[serde(alias = "query")]
    #[serde(rename = "userMessage")]
    prompt_text: Option<String>,
    /// Prompt token count from various field name conventions.
    #[serde(alias = "prompt_tokens", alias = "numPromptTokens", alias = "numTokens", alias = "tokenCount")]
    #[serde(rename = "promptTokens")]
    prompt_tokens: Option<u32>,
    /// Completion token count from various field name conventions.
    #[serde(alias = "completion_tokens", alias = "numCompletionTokens")]
    #[serde(rename = "completionTokens")]
    completion_tokens: Option<u32>,
    /// Total token count used as a fallback when no per-role split is present.
    #[serde(alias = "total_tokens")]
    #[serde(rename = "totalTokens")]
    total_tokens: Option<u32>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "chatSessionId")]
    chat_session_id: Option<String>,
    #[serde(rename = "conversationId")]
    conversation_id: Option<String>,
}

/// Extract the first `{ … }` JSON object slice from a log line.
/// Returns a `&str` slice into the original string — no allocation.
fn extract_json(line: &str) -> Option<&str> {
    let start = line.find('{')?;
    let end = line.rfind('}')?;
    if start < end {
        Some(&line[start..=end])
    } else {
        None
    }
}

/// Case-insensitive ASCII substring search.
///
/// Performs byte-by-byte comparison using [`u8::to_ascii_lowercase`] so that
/// no heap allocation is needed (unlike `str::to_lowercase`). Both
/// `haystack` and `needle` must be pure ASCII for correct results; all
/// patterns used in this module satisfy that requirement.
fn ascii_ci_contains(haystack: &str, needle_lower: &str) -> bool {
    let h = haystack.as_bytes();
    let n = needle_lower.as_bytes();
    if n.is_empty() {
        return true;
    }
    if n.len() > h.len() {
        return false;
    }
    h.windows(n.len())
        .any(|w| w.iter().zip(n).all(|(hb, nb)| hb.to_ascii_lowercase() == *nb))
}

/// Extract a latency value in milliseconds from a plain-text log line.
///
/// Looks for the pattern `<number>ms` (e.g. `after 290ms`, `in 45ms`).
/// Returns the last numeric value followed by `ms` found in the line,
/// or `None` when no such pattern exists.
fn extract_latency_from_text(line: &str) -> Option<u32> {
    let bytes = line.as_bytes();
    let mut i = bytes.len();
    while i >= 2 {
        i -= 1;
        if bytes[i] == b's' && bytes[i - 1] == b'm' {
            let ms_pos = i - 1;
            let mut j = ms_pos;
            while j > 0 && bytes[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < ms_pos {
                let num_str = &line[j..ms_pos];
                if let Ok(v) = num_str.parse::<u32>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn normalize_timestamp(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.len() >= 19
        && trimmed.as_bytes().get(4) == Some(&b'-')
        && trimmed.as_bytes().get(7) == Some(&b'-')
        && trimmed.as_bytes().get(10) == Some(&b' ')
        && trimmed.as_bytes().get(13) == Some(&b':')
        && trimmed.as_bytes().get(16) == Some(&b':')
    {
        let suffix = trimmed.as_bytes().get(19).copied();
        if !matches!(suffix, Some(b'Z' | b'+' | b'-' | b'a'..=b'z' | b'A'..=b'Z')) {
            let mut out = trimmed.to_string();
            out.replace_range(10..11, "T");
            return out;
        }
    }

    trimmed.to_string()
}

fn extract_timestamp_from_text(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let min_len = 19;
    if bytes.len() < min_len {
        return None;
    }

    for start in 0..=bytes.len() - min_len {
        let candidate = &raw[start..];
        if candidate.len() < min_len {
            break;
        }
        let probe = &candidate[..min_len];
        let probe_bytes = probe.as_bytes();
        let matches_date_time = probe_bytes.get(4) == Some(&b'-')
            && probe_bytes.get(7) == Some(&b'-')
            && matches!(probe_bytes.get(10), Some(b'T' | b' '))
            && probe_bytes.get(13) == Some(&b':')
            && probe_bytes.get(16) == Some(&b':')
            && probe_bytes
                .iter()
                .enumerate()
                .all(|(idx, byte)| match idx {
                    4 | 7 => *byte == b'-',
                    10 => *byte == b'T' || *byte == b' ',
                    13 | 16 => *byte == b':',
                    _ => byte.is_ascii_digit(),
                });
        if !matches_date_time {
            continue;
        }

        let mut end = start + min_len;
        while let Some(byte) = bytes.get(end) {
            if byte.is_ascii_digit() || matches!(*byte, b'.' | b'Z' | b'+' | b'-' | b':') {
                end += 1;
            } else {
                break;
            }
        }
        return Some(normalize_timestamp(&raw[start..end]));
    }

    None
}

fn resolve_session_id(entry: &LogEntry) -> Option<&str> {
    entry
        .session_id
        .as_deref()
        .or(entry.chat_session_id.as_deref())
        .or(entry.conversation_id.as_deref())
}

fn is_chat_turn_event(event_lower: &str) -> bool {
    event_lower.contains("chat/request")
        || event_lower.contains("chat.request")
        || event_lower.contains("chatrequest")
        || event_lower.contains("message.sent")
        || event_lower.contains("conversation.request")
}

fn is_code_action_event(event_lower: &str) -> bool {
    event_lower.contains("code.copy")
        || event_lower.contains("codeblock.copy")
        || event_lower.contains(".copy")
        || event_lower.contains("code.apply")
        || event_lower.contains("apply_patch")
        || event_lower.contains("workspace/editfile")
        || event_lower.contains("code.insert")
        || event_lower.contains(".insert")
}

fn parse_browser_tool_type(raw: &str) -> &'static str {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("screenshot") {
        return "screenshot";
    }
    if lower.contains("navigate") {
        return "navigate";
    }
    if lower.contains("click") {
        return "click";
    }
    if lower.contains("type") || lower.contains("fill") {
        return "type";
    }
    if lower.contains("scroll") {
        return "scroll";
    }
    if lower.contains("browser") {
        return "browser";
    }
    "playwright"
}

fn parse_memory_management_type(raw: &str) -> &'static str {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("/compact") {
        return "compact";
    }
    if lower.contains("session memory") || lower.contains("session_memory") {
        return "session-memory";
    }
    if lower.contains("context_limit_reached")
        || lower.contains("truncating_history")
        || lower.contains("truncating history")
        || lower.contains("context_limit")
        || lower.contains("context limit")
    {
        return "context-limit";
    }
    if lower.contains("summarize_context") || lower.contains("summarize context") {
        return "summarize";
    }
    if lower.contains("compaction") {
        return "compaction";
    }
    "memory"
}

fn push_session_signal(
    stats: &mut NativeStats,
    timestamp: &str,
    signal_type: &str,
    actor: &str,
    phase: &str,
    intent: &str,
    raw_text: &str,
    model_name: &str,
    latency_ms: u32,
    success: bool,
    session_id: &str,
) {
    if timestamp.is_empty() {
        return;
    }

    stats.session_signals.push(NativeSessionSignal {
        timestamp: timestamp.to_string(),
        signal_type: signal_type.to_string(),
        actor: actor.to_string(),
        phase: phase.to_string(),
        intent: intent.to_string(),
        raw_text: raw_text.to_string(),
        model_name: model_name.to_string(),
        latency_ms,
        success,
        session_id: session_id.to_string(),
    });
}

fn update_chat_session_state(stats: &mut NativeStats, session_id: &str, turn_delta: u32, accepted: bool) {
    if session_id.is_empty() {
        return;
    }

    let state = stats
        .chat_session_states
        .entry(session_id.to_string())
        .or_insert_with(|| NativeChatSessionState {
            session_id: session_id.to_string(),
            ..NativeChatSessionState::default()
        });
    state.turn_count = state.turn_count.saturating_add(turn_delta);
    state.is_accepted = state.is_accepted || accepted;
}

fn record_feature_signals(
    stats: &mut NativeStats,
    raw: &str,
    timestamp: &str,
    session_id: &str,
    model_name: &str,
    latency_ms: u32,
) {
    let lower = raw.to_ascii_lowercase();

    let has_browser_signal = lower.contains("playwright")
        || lower.contains("browser tool")
        || lower.contains("browsertool")
        || lower.contains("browser-")
        || lower.contains("browser_")
        || lower.contains("browser")
        || lower.contains("screenshot");
    if has_browser_signal {
        let tool_type = parse_browser_tool_type(raw);
        *stats
            .browser_tools_by_type
            .entry(tool_type.to_string())
            .or_insert(0) += 1;
        push_session_signal(
            stats,
            timestamp,
            "chat-request",
            "ai",
            "research",
            &format!("browser/{}", tool_type),
            raw,
            model_name,
            latency_ms,
            true,
            session_id,
        );
    }

    let has_memory_signal = lower.contains("/compact")
        || lower.contains("session memory")
        || lower.contains("session_memory")
        || lower.contains("context_limit_reached")
        || lower.contains("truncating_history")
        || lower.contains("truncating history")
        || lower.contains("context_limit")
        || lower.contains("context limit")
        || lower.contains("summarize_context")
        || lower.contains("summarize context")
        || lower.contains("compaction");
    if has_memory_signal {
        push_session_signal(
            stats,
            timestamp,
            "memory-boundary",
            "system",
            "memory",
            parse_memory_management_type(raw),
            raw,
            model_name,
            latency_ms,
            true,
            session_id,
        );
    }
}

fn record_plan_signals(
    stats: &mut NativeStats,
    lower: &str,
    timestamp: &str,
    session_id: &str,
    raw_text: &str,
    model_name: &str,
    latency_ms: u32,
    active_plan_pending: &mut bool,
) {
    if lower.contains("agent/plan") || lower.contains("strategy/propose") {
        stats.plan_count = stats.plan_count.saturating_add(1);
        *active_plan_pending = true;
        push_session_signal(
            stats,
            timestamp,
            "plan-proposal",
            "ai",
            "planning",
            if lower.contains("strategy/propose") {
                "strategy/propose"
            } else {
                "agent/plan"
            },
            raw_text,
            model_name,
            latency_ms,
            true,
            session_id,
        );
    }

    if lower.contains("workspace/editfile") || lower.contains("apply_patch") {
        if *active_plan_pending {
            stats.executed_plan_count = stats.executed_plan_count.saturating_add(1);
            *active_plan_pending = false;
        }
        push_session_signal(
            stats,
            timestamp,
            "chat-request",
            "ai",
            "execution",
            if lower.contains("apply_patch") {
                "apply_patch"
            } else {
                "workspace/editfile"
            },
            raw_text,
            model_name,
            latency_ms,
            true,
            session_id,
        );
    }
}

/// Core parsing logic: process each line and accumulate into `NativeStats`.
fn parse_lines<I, S>(lines: I) -> NativeStats
where
    I: Iterator<Item = S>,
    S: AsRef<str>,
{
    let mut stats = NativeStats {
        total_shown: 0,
        total_accepted: 0,
        total_chat: 0,
        subagent_requests: 0,
        plan_count: 0,
        by_model_shown: HashMap::new(),
        by_model_accepted: HashMap::new(),
        by_date: HashMap::new(),
        by_hour: HashMap::new(),
        latencies: Vec::new(),
        by_context_source: HashMap::new(),
        context_richness: NativeContextRichness::default(),
        autonomous_duration_ms: 0.0,
        subagent_loops: 0,
        executed_plan_count: 0,
        browser_tools_by_type: HashMap::new(),
        errors_by_type: HashMap::new(),
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        tokens_by_model: HashMap::new(),
        session_signals: Vec::new(),
        chat_session_states: HashMap::new(),
    };
    let mut active_plan_pending = false;

    for line in lines {
        let trimmed = line.as_ref().trim();
        if trimmed.is_empty() {
            continue;
        }

        // ── JSON path ──────────────────────────────────────────────────────
        if let Some(json_str) = extract_json(trimmed) {
            if let Ok(entry) = serde_json::from_str::<LogEntry>(json_str) {
                let event = entry
                    .event
                    .as_deref()
                    .or(entry.event_name.as_deref())
                    .unwrap_or("");
                let event_lower = event.to_lowercase();

                let resolved_model: &str = entry
                    .model_name
                    .as_deref()
                    .or(entry.model_id.as_deref())
                    .or(entry.model.as_deref())
                    .or(entry.engine_id.as_deref())
                    .or(entry.engine_name.as_deref())
                    .or(entry.engine.as_deref())
                    .unwrap_or("");
                let model_name = normalize_model(resolved_model);

                let normalized_timestamp = entry
                    .time
                    .as_deref()
                    .map(normalize_timestamp)
                    .filter(|ts| !ts.is_empty())
                    .or_else(|| extract_timestamp_from_text(trimmed));
                let ts_opt = normalized_timestamp.as_deref();
                let date_key: Option<&str> = ts_opt.and_then(|ts| {
                    if ts.len() >= 10 { Some(&ts[0..10]) } else { None }
                });
                let hour_key: Option<&str> = ts_opt.and_then(|ts| {
                    if ts.len() >= 13 { Some(&ts[11..13]) } else { None }
                });
                let session_id = resolve_session_id(&entry).unwrap_or("");

                let is_shown = event_lower.contains("shown")
                    || event_lower.contains("displayed")
                    || event_lower.contains("triggered");
                let is_accepted = !is_shown && event_lower.contains("accepted");

                if is_shown {
                    stats.total_shown += 1;
                    if !resolved_model.is_empty() {
                        *stats
                            .by_model_shown
                            .entry(resolved_model.to_string())
                            .or_insert(0) += 1;
                    }
                    if let Some(dk) = date_key {
                        stats
                            .by_date
                            .entry(dk.to_string())
                            .or_default()
                            .shown += 1;
                    }
                    if let Some(hk) = hour_key {
                        *stats.by_hour.entry(hk.to_string()).or_insert(0) += 1;
                    }
                } else if is_accepted {
                    stats.total_accepted += 1;
                    if !resolved_model.is_empty() {
                        *stats
                            .by_model_accepted
                            .entry(resolved_model.to_string())
                            .or_insert(0) += 1;
                    }
                    if let Some(dk) = date_key {
                        stats
                            .by_date
                            .entry(dk.to_string())
                            .or_default()
                            .accepted += 1;
                    }
                } else if event_lower.contains("chat-request")
                    || event_lower.contains("chat.request")
                    || event_lower.contains("chat/request")
                {
                    stats.total_chat += 1;
                } else if event_lower.contains("subagent-request")
                    || event_lower.contains("subagent/request")
                {
                    stats.subagent_requests += 1;
                } else if event_lower.contains("plan-proposed")
                    || event_lower.contains("plan/proposed")
                {
                    stats.plan_count += 1;
                }

                if let Some(lat) = entry.latency_ms {
                    stats.latencies.push(lat);
                }

                if let Some(src) = entry.context_source.as_deref() {
                    if !src.is_empty() {
                        *stats
                            .by_context_source
                            .entry(src.to_string())
                            .or_insert(0) += 1;
                    }
                }

                // Prompt-length tracking.
                if let Some(text) = entry.prompt_text.as_deref() {
                    if !text.is_empty() {
                        stats.context_richness.total_prompt_chars =
                            stats.context_richness.total_prompt_chars.saturating_add(text.len() as u32);
                        stats.context_richness.prompt_count =
                            stats.context_richness.prompt_count.saturating_add(1);
                    }
                }

                // Token consumption tracking.
                // Use prompt_tokens if present; fall back to total_tokens when
                // no explicit per-role split is available.
                let pt = entry.prompt_tokens.unwrap_or(0);
                let ct = entry.completion_tokens.unwrap_or(0);
                let tt = entry.total_tokens.unwrap_or(0);
                // If only total_tokens is present (no explicit prompt/completion split),
                // credit it entirely to completions to avoid double-counting.
                let effective_ct = if ct > 0 { ct } else if pt == 0 { tt } else { 0 };
                if pt > 0 || effective_ct > 0 {
                    stats.total_prompt_tokens =
                        stats.total_prompt_tokens.saturating_add(pt);
                    stats.total_completion_tokens =
                        stats.total_completion_tokens.saturating_add(effective_ct);
                    if !resolved_model.is_empty() {
                        let model_key = normalize_model(resolved_model);
                        let entry_vec = stats
                            .tokens_by_model
                            .entry(model_key)
                            .or_insert_with(|| vec![0, 0]);
                        entry_vec[0] = entry_vec[0].saturating_add(pt);
                        entry_vec[1] = entry_vec[1].saturating_add(effective_ct);
                    }
                }

                if is_chat_turn_event(&event_lower) {
                    update_chat_session_state(&mut stats, session_id, 1, false);
                }
                if is_code_action_event(&event_lower) {
                    update_chat_session_state(&mut stats, session_id, 0, true);
                }

                let timestamp = ts_opt.unwrap_or("");
                let latency_ms = entry.latency_ms.unwrap_or(0);
                record_plan_signals(
                    &mut stats,
                    &event_lower,
                    timestamp,
                    session_id,
                    event,
                    &model_name,
                    latency_ms,
                    &mut active_plan_pending,
                );
                record_feature_signals(
                    &mut stats,
                    json_str,
                    timestamp,
                    session_id,
                    &model_name,
                    latency_ms,
                );

                continue;
            }
        }

        // ── Plain-text path ────────────────────────────────────────────────
        let timestamp = extract_timestamp_from_text(trimmed).unwrap_or_default();
        let latency_ms = extract_latency_from_text(trimmed).unwrap_or(0);
        if ascii_ci_contains(trimmed, "[fetchcompletions]")
            || ascii_ci_contains(trimmed, "ccreq:")
        {
            stats.total_shown += 1;
            if latency_ms > 0 {
                stats.latencies.push(latency_ms);
            }
        }
        record_plan_signals(
            &mut stats,
            &trimmed.to_ascii_lowercase(),
            &timestamp,
            "",
            trimmed,
            "",
            latency_ms,
            &mut active_plan_pending,
        );
        record_feature_signals(&mut stats, trimmed, &timestamp, "", "", latency_ms);
    }

    stats
}

// ── Report-generation helpers ────────────────────────────────────────────────

/// Estimated average characters per inline-completion acceptance.
const AVG_CHARS_PER_COMPLETION: f64 = 40.0;
/// Estimated professional developer typing speed in chars-per-minute.
const TYPING_SPEED_CPM: f64 = 200.0;
/// Cognitive weight applied to autonomous AI duration for agentic ROI.
const AGENTIC_COGNITIVE_WEIGHT: f64 = 0.5;

/// Format a millisecond duration as a human-readable string (e.g. `"2h 5m 30s"`).
fn format_duration_ms(ms: f64) -> String {
    let total_sec = (ms / 1000.0).round() as u64;
    let h = total_sec / 3600;
    let m = (total_sec % 3600) / 60;
    let s = total_sec % 60;
    if h > 0 {
        format!("{}h {}m {}s", h, m, s)
    } else if m > 0 {
        format!("{}m {}s", m, s)
    } else {
        format!("{}s", s)
    }
}

/// Normalise a raw model name using the same rules as the TypeScript
/// `normalizeModelName` helper in `parserHelpers.ts`.
///
/// Rules applied in order:
/// 1. Strip everything after ` -> ` (deployment path).
/// 2. Strip colon-suffix (version / date / ID).
/// 3. Strip hash-suffix.
/// 4. Strip trailing `-copilot` vendor suffix.
fn normalize_model(model: &str) -> String {
    // Rule 1
    let base = if let Some(idx) = model.find(" -> ") { &model[..idx] } else { model };
    let mut base = base.trim().to_string();
    // Rule 2
    if let Some(idx) = base.find(':') {
        if idx > 0 {
            base = base[..idx].trim().to_string();
        }
    }
    // Rule 3
    if let Some(idx) = base.find('#') {
        if idx > 0 {
            base = base[..idx].trim().to_string();
        }
    }
    // Rule 4
    if base.to_lowercase().ends_with("-copilot") {
        let new_len = base.len() - "-copilot".len();
        base.truncate(new_len);
        base = base.trim().to_string();
    }
    base
}

/// Aggregate a `u32`-valued map by normalised model name.
fn merge_normalized_u32(input: &HashMap<String, u32>) -> HashMap<String, u32> {
    let mut out: HashMap<String, u32> = HashMap::new();
    for (k, &v) in input {
        *out.entry(normalize_model(k)).or_insert(0) += v;
    }
    out
}

/// Aggregate an `f64`-valued map by normalised model name.
fn merge_normalized_f64(input: &HashMap<String, f64>) -> HashMap<String, f64> {
    let mut out: HashMap<String, f64> = HashMap::new();
    for (k, &v) in input {
        *out.entry(normalize_model(k)).or_insert(0.0) += v;
    }
    out
}

/// Generate a Markdown report from the provided `ReportInput` data.
///
/// Produces the following sections (all non-optional relative to the data):
/// - Header (title, project, period)
/// - Executive Summary
/// - Agentic ROI Summary (when `subagent_requests > 0`)
/// - VS Code 1.110 Feature Signals (when any feature count is non-zero)
/// - Agent Intelligence Details (when `subagent_requests > 0`)
/// - Planning & Strategic Autonomy (when `plan_count > 0`)
/// - Model Efficiency (when `subagent_by_model` is non-empty)
/// - Productivity Metrics
///
/// Optional sections that depend on externally-computed metrics
/// (Acceptance Analysis, Model Performance, Velocity, Insights, Footer)
/// are intentionally omitted and should be appended by the TypeScript caller.
///
/// The `period` parameter is inserted verbatim into the `**Period:**` header line.
#[napi]
pub fn generate_markdown_report_native(input: ReportInput, period: String) -> String {
    let mut buf = String::with_capacity(4096);

    // ── Header ───────────────────────────────────────────────────────────────
    let date_range_suffix = {
        let min = input.min_date.as_str();
        let max = input.max_date.as_str();
        if !min.is_empty() && !max.is_empty() {
            if min == max {
                format!(" ({})", min.replace('-', "/"))
            } else {
                format!(" ({} - {})", min.replace('-', "/"), max.replace('-', "/"))
            }
        } else {
            String::new()
        }
    };

    let _ = writeln!(buf, "# GitHub Copilot Contribution Report{}", date_range_suffix);
    let _ = writeln!(buf);
    if !input.project_name.is_empty() {
        let _ = writeln!(buf, "**Project:** {}", input.project_name);
    }
    let _ = writeln!(buf, "**Period:** {}", period);
    let _ = writeln!(buf);

    // ── 1. Executive Summary ─────────────────────────────────────────────────
    let acceptance_rate = if input.total_shown > 0 {
        input.total_accepted as f64 / input.total_shown as f64 * 100.0
    } else {
        0.0
    };
    let avg_latency_display = if input.avg_latency_ms > 0.0 {
        format!("{:.0}ms", input.avg_latency_ms)
    } else {
        "\u{2014}".to_string() // em dash
    };
    let _ = writeln!(buf, "## Executive Summary");
    let _ = writeln!(buf);
    let _ = writeln!(buf, "| Metric | Value |");
    let _ = writeln!(buf, "|--------|-------|");
    let _ = writeln!(buf, "| Suggestions Shown | {} |", input.total_shown);
    let _ = writeln!(buf, "| Suggestions Accepted | {} |", input.total_accepted);
    let _ = writeln!(buf, "| Acceptance Rate | {:.1}% |", acceptance_rate);
    let _ = writeln!(buf, "| Chat Requests | {} |", input.total_chat);
    let _ = writeln!(buf, "| Avg Latency | {} |", avg_latency_display);
    let _ = writeln!(buf, "| Errors | {} |", input.total_errors);
    let _ = writeln!(buf, "| Log Files Parsed | {} |", input.log_files_found);
    let _ = writeln!(buf);

    // ── 2. Agentic ROI Summary ───────────────────────────────────────────────
    if input.subagent_requests > 0 {
        let dur_str = format_duration_ms(input.autonomous_duration_ms);
        let _ = writeln!(buf, "## Agentic ROI Summary");
        let _ = writeln!(buf);
        let _ = writeln!(
            buf,
            "> 🤖 **AI Autonomous Time: {}** \u{2014} time during which Copilot was autonomously acting on your behalf.",
            dur_str
        );
        let _ = writeln!(buf);
        let _ = writeln!(buf, "| Metric | Value |");
        let _ = writeln!(buf, "|--------|-------|");
        let _ = writeln!(buf, "| Autonomous Duration | {} |", dur_str);
        let _ = writeln!(buf, "| Agentic Requests | {} |", input.subagent_requests);
        let _ = writeln!(buf, "| Agentic Ratio | {:.1}% |", input.agentic_ratio);
        let _ = writeln!(buf, "| Episodes Completed | {} |", input.subagent_loops);
        let _ = writeln!(buf, "| Episodes Started | {} |", input.subagent_loops_started);
        let completion_str = if input.completion_rate > 0.0 {
            format!("{:.1}%", input.completion_rate)
        } else {
            "\u{2014}".to_string()
        };
        let _ = writeln!(buf, "| Episode Completion Rate | {} |", completion_str);
        let _ = writeln!(buf);
    }

    // ── VS Code 1.110 Feature Signals ────────────────────────────────────────
    let browser_total: u32 = input.browser_tools_by_type.values().sum();
    let plugin_total: u32 = input.plugin_or_skill_by_name.values().sum();
    let has_feature_signals = browser_total > 0
        || plugin_total > 0
        || input.memory_management_count > 0
        || input.agent_debug_events > 0;

    if has_feature_signals {
        let _ = writeln!(buf, "## VS Code 1.110 Feature Signals");
        let _ = writeln!(buf);

        // Helper: sort a map by value desc, then key asc, and write lines.
        let write_breakdown = |buf: &mut String, total: u32, map: &HashMap<String, u32>| {
            let _ = writeln!(buf, "- **Total Observed Events**: {}", total);
            let mut sorted: Vec<(&String, &u32)> = map.iter().collect();
            sorted.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
            for (name, count) in sorted {
                let _ = writeln!(buf, "- **{}**: {}", name, count);
            }
            let _ = writeln!(buf);
        };

        if browser_total > 0 {
            let _ = writeln!(buf, "### Browser Tools");
            let _ = writeln!(buf);
            write_breakdown(&mut buf, browser_total, &input.browser_tools_by_type);
        }
        if plugin_total > 0 {
            let _ = writeln!(buf, "### Plugins / Skills");
            let _ = writeln!(buf);
            write_breakdown(&mut buf, plugin_total, &input.plugin_or_skill_by_name);
        }
        if input.memory_management_count > 0 {
            let _ = writeln!(buf, "### Session Memory / Compact");
            let _ = writeln!(buf);
            write_breakdown(
                &mut buf,
                input.memory_management_count,
                &input.memory_management_by_type,
            );
        }
        if input.agent_debug_events > 0 {
            let _ = writeln!(buf, "### Agent Debug");
            let _ = writeln!(buf);
            write_breakdown(&mut buf, input.agent_debug_events, &input.agent_debug_by_type);
        }
    }

    // ── 3. Agent Intelligence Details ────────────────────────────────────────
    if input.subagent_requests > 0 {
        let avg_calls = if input.subagent_loops > 0 {
            input.subagent_requests as f64 / input.subagent_loops as f64
        } else {
            0.0
        };
        let avg_str = if avg_calls > 0.0 {
            format!("{:.1}", avg_calls)
        } else {
            "\u{2014}".to_string()
        };
        let completion_str = if input.completion_rate > 0.0 {
            format!("{:.1}%", input.completion_rate)
        } else {
            "\u{2014}".to_string()
        };
        let _ = writeln!(buf, "## Agent Intelligence Details");
        let _ = writeln!(buf);
        let _ = writeln!(buf, "| Metric | Value |");
        let _ = writeln!(buf, "|--------|-------|");
        let _ = writeln!(buf, "| Total Autonomous Actions | {} |", input.subagent_requests);
        let _ = writeln!(buf, "| Completed Agentic Loops | {} |", input.subagent_loops);
        let _ = writeln!(buf, "| Avg Calls / Loop (Thinking Depth) | {} |", avg_str);
        let _ = writeln!(buf, "| Episode Completion Rate | {} |", completion_str);
        let _ = writeln!(buf);
    }

    // ── 3a. Planning & Strategic Autonomy ────────────────────────────────────
    if input.plan_count > 0 {
        let success_rate = input.executed_plan_count as f64 / input.plan_count as f64 * 100.0;
        let _ = writeln!(buf, "## \u{1F9E0} Planning & Strategic Autonomy");
        let _ = writeln!(buf);
        let _ = writeln!(
            buf,
            "> AI-proposed plans that were adopted and implemented \u{2014} a measure of strategic alignment between AI and developer."
        );
        let _ = writeln!(buf);
        let _ = writeln!(buf, "- **Strategic Plans Proposed**: {}", input.plan_count);
        let _ = writeln!(buf, "- **Plans Executed (Implemented)**: {}", input.executed_plan_count);
        let _ = writeln!(buf, "- **Planning Success Rate**: {:.1}%", success_rate);
        let _ = writeln!(buf, "- **In-Plan User Interactions**: {}", input.user_choices_in_plan);
        let _ = writeln!(buf);
    }

    // ── 4. Model Efficiency ───────────────────────────────────────────────────
    if !input.subagent_by_model.is_empty() {
        let norm_subagent = merge_normalized_u32(&input.subagent_by_model);
        let norm_duration = merge_normalized_f64(&input.autonomous_duration_by_model);
        let norm_chat = merge_normalized_u32(&input.by_chat_model);

        let mut entries: Vec<(String, u32, f64, f64)> = norm_subagent
            .iter()
            .map(|(model, &subagent_count)| {
                let duration_ms = norm_duration.get(model).copied().unwrap_or(0.0);
                let velocity_sec = if duration_ms > 0.0 && subagent_count > 0 {
                    duration_ms / subagent_count as f64 / 1000.0
                } else {
                    0.0
                };
                let chat_count = norm_chat.get(model).copied().unwrap_or(0);
                let autonomous_ratio = if chat_count > 0 {
                    subagent_count as f64 / chat_count as f64 * 100.0
                } else {
                    0.0
                };
                (model.clone(), subagent_count, autonomous_ratio, velocity_sec)
            })
            .collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1));

        let _ = writeln!(buf, "## Model Efficiency");
        let _ = writeln!(buf);
        let _ = writeln!(buf, "| Model | Autonomous Actions | Autonomous Ratio | Avg sec / Action |");
        let _ = writeln!(buf, "|-------|-------------------|--------------------|-----------------|");
        for (model, count, ratio, velocity) in entries.iter().take(20) {
            let ratio_str = if *ratio > 0.0 {
                format!("{:.1}%", ratio)
            } else {
                "\u{2014}".to_string()
            };
            let vel_str = if *velocity > 0.0 {
                format!("{:.1}s", velocity)
            } else {
                "\u{2014}".to_string()
            };
            let _ = writeln!(buf, "| {} | {} | {} | {} |", model, count, ratio_str, vel_str);
        }
        let _ = writeln!(buf);
    }

    // ── 8. Productivity Metrics ───────────────────────────────────────────────
    let typing_mins = if input.typing_minutes_saved > 0.0 {
        input.typing_minutes_saved
    } else {
        (input.total_accepted as f64 * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM
    };
    let agentic_mins = if input.agentic_minutes_saved > 0.0 {
        input.agentic_minutes_saved
    } else {
        (input.autonomous_duration_ms / 60_000.0) * AGENTIC_COGNITIVE_WEIGHT
    };
    let total_mins = typing_mins + agentic_mins;
    let total_hours = total_mins / 60.0;
    let typing_hours = typing_mins / 60.0;
    let agentic_hours = agentic_mins / 60.0;

    let _ = writeln!(buf, "## \u{1F4CA} Productivity Metrics");
    let _ = writeln!(buf);
    let _ = writeln!(buf, "- **Total Developer Time Saved**: {:.1} hours", total_hours);
    let _ = writeln!(
        buf,
        "  - *Coding Assistance*: {:.1} hours (based on characters accepted)",
        typing_hours
    );
    if agentic_mins > 0.0 {
        let _ = writeln!(
            buf,
            "  - *Agentic Autonomy*: {:.1} hours (AI-led task execution)",
            agentic_hours
        );
    }
    let _ = writeln!(buf);

    buf
}

/// Parse a log chunk provided as a string and return aggregated statistics.
///
/// This function processes each non-empty line of `input`, classifying it as
/// either a JSON-embedded log entry or a plain-text inline-completion line.
/// The resulting `NativeStats` object is returned directly to JavaScript
/// without any intermediate JSON serialization.
#[napi]
pub fn parse_log_chunk(input: String) -> NativeStats {
    parse_lines(input.lines().map(|l| l.to_string()))
}

/// Parse a log file at the given `path` directly from the filesystem and
/// return aggregated statistics.
///
/// File I/O is performed entirely in Rust using `std::fs::File` and
/// `BufReader`, eliminating the need for Node.js to read the file first.
/// Returns a NAPI `Error` if the file cannot be opened or if the parser panics.
#[napi]
pub fn parse_log_file_native(path: String) -> napi::Result<NativeStats> {
    let file = File::open(&path)
        .map_err(|e| napi::Error::from_reason(format!("Failed to open {path}: {e}")))?;
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
    eprintln!("[native-parser] start: {path} ({file_size} bytes)");
    let reader = BufReader::new(file);
    let lines = reader.lines().filter_map(|l| l.ok());
    let path_for_err = path.clone();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| Ok(parse_lines(lines)))).unwrap_or_else(
        |e| {
            let msg = e
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| e.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown panic");
            eprintln!("[native-parser] PANIC in {path_for_err}: {msg}");
            Err(napi::Error::from_reason(format!(
                "native parser panicked on {path_for_err}: {msg}"
            )))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(input: &str) -> NativeStats {
        parse_lines(input.lines().map(|l| l.to_string()))
    }

    #[test]
    fn empty_input_returns_zeros() {
        let s = parse("");
        assert_eq!(s.total_shown, 0);
        assert_eq!(s.total_accepted, 0);
        assert_eq!(s.total_chat, 0);
        assert_eq!(s.subagent_requests, 0);
        assert_eq!(s.plan_count, 0);
    }

    #[test]
    fn skips_blank_lines() {
        let s = parse("\n\n  \n");
        assert_eq!(s.total_shown, 0);
        assert_eq!(s.total_accepted, 0);
    }

    #[test]
    fn counts_shown_and_accepted_json_events() {
        let input = concat!(
            r#"{"event":"ghost-text/shown","modelId":"gpt-4o"}"#,
            "\n",
            r#"{"event":"ghost-text/accepted","modelId":"gpt-4o"}"#,
            "\n",
            r#"{"event":"suggestion_shown"}"#,
        );
        let s = parse(input);
        assert_eq!(s.total_shown, 2);
        assert_eq!(s.total_accepted, 1);
        assert_eq!(s.by_model_shown.get("gpt-4o"), Some(&1));
        assert_eq!(s.by_model_accepted.get("gpt-4o"), Some(&1));
    }

    #[test]
    fn counts_chat_subagent_plan_json_events() {
        let input = concat!(
            r#"{"event":"copilot/chat-request"}"#,
            "\n",
            r#"{"event":"copilot/subagent-request"}"#,
            "\n",
            r#"{"event":"copilot/plan-proposed"}"#,
        );
        let s = parse(input);
        assert_eq!(s.total_chat, 1);
        assert_eq!(s.subagent_requests, 1);
        assert_eq!(s.plan_count, 1);
    }

    #[test]
    fn handles_embedded_json() {
        let input =
            r#"2024-06-01 [info] {"event":"ghost-text/shown","modelId":"gpt-4o"}"#;
        let s = parse(input);
        assert_eq!(s.total_shown, 1);
        assert_eq!(s.by_model_shown.get("gpt-4o"), Some(&1));
    }

    #[test]
    fn counts_plain_text_fetch_completions() {
        let input = "[fetchCompletions] Request to /v1/engines/gpt-4.5/completions finished with 200 status after 290ms";
        let s = parse(input);
        assert_eq!(s.total_shown, 1);
    }

    #[test]
    fn counts_plain_text_ccreq() {
        let input = "2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]";
        let s = parse(input);
        assert_eq!(s.total_shown, 1);
    }

    #[test]
    fn accumulates_multiple_models() {
        let input = concat!(
            r#"{"event":"ghost-text/shown","modelId":"gpt-4o"}"#,
            "\n",
            r#"{"event":"ghost-text/shown","modelId":"claude-3.5-sonnet"}"#,
            "\n",
            r#"{"event":"ghost-text/shown","modelId":"gpt-4o"}"#,
            "\n",
            r#"{"event":"ghost-text/accepted","modelId":"gpt-4o"}"#,
        );
        let s = parse(input);
        assert_eq!(s.total_shown, 3);
        assert_eq!(s.total_accepted, 1);
        assert_eq!(s.by_model_shown.get("gpt-4o"), Some(&2));
        assert_eq!(s.by_model_shown.get("claude-3.5-sonnet"), Some(&1));
        assert_eq!(s.by_model_accepted.get("gpt-4o"), Some(&1));
    }

    #[test]
    fn uses_event_name_fallback() {
        let input = r#"{"eventName":"ghost-text/shown","model":"gemini-pro"}"#;
        let s = parse(input);
        assert_eq!(s.total_shown, 1);
        assert_eq!(s.by_model_shown.get("gemini-pro"), Some(&1));
    }

    #[test]
    fn model_priority_order() {
        let input = r#"{"event":"ghost-text/shown","model_name":"priority-model","modelId":"fallback-model"}"#;
        let s = parse(input);
        assert_eq!(s.by_model_shown.get("priority-model"), Some(&1));
        assert_eq!(s.by_model_shown.get("fallback-model"), None);
    }

    #[test]
    fn populates_by_date_and_by_hour_for_shown() {
        let input =
            r#"{"event":"ghost-text/shown","modelId":"gpt-4o","time":"2024-06-15T14:32:00Z"}"#;
        let s = parse(input);
        assert_eq!(s.by_date.get("2024-06-15").map(|d| d.shown), Some(1));
        assert_eq!(s.by_date.get("2024-06-15").map(|d| d.accepted), Some(0));
        assert_eq!(s.by_hour.get("14"), Some(&1));
    }

    #[test]
    fn populates_by_date_for_accepted() {
        let input = concat!(
            r#"{"event":"ghost-text/shown","time":"2024-06-15T09:00:00Z"}"#,
            "\n",
            r#"{"event":"ghost-text/accepted","time":"2024-06-15T09:01:00Z"}"#,
        );
        let s = parse(input);
        assert_eq!(s.by_date.get("2024-06-15").map(|d| d.shown), Some(1));
        assert_eq!(s.by_date.get("2024-06-15").map(|d| d.accepted), Some(1));
    }

    #[test]
    fn accepts_timestamp_alias() {
        let input = r#"{"event":"ghost-text/shown","timestamp":"2024-07-01T08:00:00Z"}"#;
        let s = parse(input);
        assert_eq!(s.by_date.get("2024-07-01").map(|d| d.shown), Some(1));
        assert_eq!(s.by_hour.get("08"), Some(&1));
    }

    #[test]
    fn collects_latency_from_json() {
        let input = r#"{"event":"ghost-text/shown","latencyMs":150}"#;
        let s = parse(input);
        assert_eq!(s.latencies.first(), Some(&150));
    }

    #[test]
    fn collects_latency_from_text_fetch_completions() {
        let input = "[fetchCompletions] Request finished after 290ms";
        let s = parse(input);
        assert_eq!(s.latencies.first(), Some(&290));
    }

    #[test]
    fn collects_latency_from_text_ccreq() {
        let input = "2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]";
        let s = parse(input);
        assert_eq!(s.latencies.first(), Some(&800));
    }

    #[test]
    fn collects_by_context_source() {
        let input = concat!(
            r#"{"event":"ghost-text/shown","context_source":"vscodePrompt"}"#,
            "\n",
            r#"{"event":"ghost-text/shown","context_source":"vscodePrompt"}"#,
            "\n",
            r#"{"event":"ghost-text/shown","context_source":"activeDocument"}"#,
        );
        let s = parse(input);
        assert_eq!(s.by_context_source.get("vscodePrompt"), Some(&2));
        assert_eq!(s.by_context_source.get("activeDocument"), Some(&1));
    }

    #[test]
    fn empty_input_has_empty_new_fields() {
        let s = parse("");
        assert!(s.by_date.is_empty());
        assert!(s.by_hour.is_empty());
        assert!(s.latencies.is_empty());
        assert!(s.by_context_source.is_empty());
        assert_eq!(s.autonomous_duration_ms, 0.0);
        assert_eq!(s.subagent_loops, 0);
        assert_eq!(s.executed_plan_count, 0);
        assert!(s.browser_tools_by_type.is_empty());
        assert!(s.errors_by_type.is_empty());
        assert_eq!(s.total_prompt_tokens, 0);
        assert_eq!(s.total_completion_tokens, 0);
        assert!(s.tokens_by_model.is_empty());
        assert!(s.session_signals.is_empty());
        assert!(s.chat_session_states.is_empty());
    }

    #[test]
    fn accumulates_token_counts_from_json() {
        let input = concat!(
            r#"{"event":"chat/request","modelId":"gpt-4o","promptTokens":500,"completionTokens":80}"#,
            "\n",
            r#"{"event":"chat/request","modelId":"gpt-4o","promptTokens":300,"completionTokens":60}"#,
            "\n",
            r#"{"event":"chat/request","modelId":"claude-3.5-sonnet","prompt_tokens":400,"completion_tokens":100}"#,
        );
        let s = parse(input);
        assert_eq!(s.total_prompt_tokens, 1200);
        assert_eq!(s.total_completion_tokens, 240);
        let gpt_tokens = s.tokens_by_model.get("gpt-4o");
        assert!(gpt_tokens.is_some());
        let gpt = gpt_tokens.unwrap();
        assert_eq!(gpt[0], 800);
        assert_eq!(gpt[1], 140);
        let claude_tokens = s.tokens_by_model.get("claude-3.5-sonnet");
        assert!(claude_tokens.is_some());
        let claude = claude_tokens.unwrap();
        assert_eq!(claude[0], 400);
        assert_eq!(claude[1], 100);
    }

    #[test]
    fn uses_total_tokens_as_fallback_completion() {
        // When only totalTokens is present and no explicit split, treat as completion tokens.
        let input = r#"{"event":"chat/request","modelId":"gpt-4o","totalTokens":300}"#;
        let s = parse(input);
        assert_eq!(s.total_prompt_tokens, 0);
        assert_eq!(s.total_completion_tokens, 300);
    }

    #[test]
    fn captures_chat_session_state_from_json_events() {
        let input = concat!(
            r#"{"event":"chat/request","sessionId":"chat-1"}"#,
            "\n",
            r#"{"event":"message.sent","chatSessionId":"chat-1"}"#,
            "\n",
            r#"{"event":"workspace/editfile","conversationId":"chat-1"}"#,
        );
        let s = parse(input);
        let state = s.chat_session_states.get("chat-1").unwrap();
        assert_eq!(state.turn_count, 2);
        assert!(state.is_accepted);
    }

    #[test]
    fn captures_plan_and_feature_session_signals() {
        let input = concat!(
            r#"{"event":"agent/plan","timestamp":"2026-03-26T12:00:00Z","sessionId":"chat-1","modelId":"gpt-4o"}"#,
            "\n",
            r#"{"event":"workspace/editfile","timestamp":"2026-03-26T12:00:01Z","sessionId":"chat-1","modelId":"gpt-4o"}"#,
            "\n",
            r#"{"event":"tool_call","timestamp":"2026-03-26T12:00:02Z","sessionId":"chat-1","toolName":"screenshot"}"#,
            "\n",
            r#"{"event":"context_limit_reached","timestamp":"2026-03-26T12:00:03Z","sessionId":"chat-1"}"#,
        );
        let s = parse(input);
        assert_eq!(s.plan_count, 1);
        assert_eq!(s.executed_plan_count, 1);
        assert_eq!(s.browser_tools_by_type.get("screenshot"), Some(&1));
        assert_eq!(s.session_signals.len(), 4);
        assert_eq!(s.session_signals[0].signal_type, "plan-proposal");
        assert_eq!(s.session_signals[0].model_name, "gpt-4o");
        assert_eq!(s.session_signals[1].phase, "execution");
        assert_eq!(s.session_signals[2].intent, "browser/screenshot");
        assert_eq!(s.session_signals[3].signal_type, "memory-boundary");
    }

    // ── generate_markdown_report_native tests ─────────────────────────────────

    fn make_minimal_report_input() -> ReportInput {
        ReportInput {
            total_shown: 100,
            total_accepted: 70,
            total_chat: 15,
            total_errors: 2,
            log_files_found: 5,
            avg_latency_ms: 250.0,
            subagent_requests: 0,
            autonomous_duration_ms: 0.0,
            agentic_ratio: 0.0,
            subagent_loops: 0,
            subagent_loops_started: 0,
            completion_rate: 0.0,
            plan_count: 0,
            executed_plan_count: 0,
            user_choices_in_plan: 0,
            browser_tools_by_type: HashMap::new(),
            plugin_or_skill_by_name: HashMap::new(),
            memory_management_count: 0,
            memory_management_by_type: HashMap::new(),
            agent_debug_events: 0,
            agent_debug_by_type: HashMap::new(),
            subagent_by_model: HashMap::new(),
            autonomous_duration_by_model: HashMap::new(),
            by_chat_model: HashMap::new(),
            min_date: "2026-02-01".to_string(),
            max_date: "2026-02-28".to_string(),
            typing_minutes_saved: 0.0,
            agentic_minutes_saved: 0.0,
            project_name: String::new(),
            errors_by_type: HashMap::new(),
        }
    }

    #[test]
    fn report_contains_header_and_period() {
        let report = generate_markdown_report_native(
            make_minimal_report_input(),
            "2026-02-01 — 2026-02-28".to_string(),
        );
        assert!(report.contains("# GitHub Copilot Contribution Report"), "missing title");
        assert!(report.contains("**Period:** 2026-02-01 — 2026-02-28"), "missing period");
    }

    #[test]
    fn report_title_includes_date_range() {
        let report = generate_markdown_report_native(
            make_minimal_report_input(),
            "test".to_string(),
        );
        assert!(
            report.contains("(2026/02/01 - 2026/02/28)"),
            "expected date range in title, got: {}",
            report.lines().next().unwrap_or("")
        );
    }

    #[test]
    fn report_title_single_date_when_min_equals_max() {
        let mut input = make_minimal_report_input();
        input.min_date = "2026-02-28".to_string();
        input.max_date = "2026-02-28".to_string();
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(
            report.contains("(2026/02/28)"),
            "expected single date, got: {}",
            report.lines().next().unwrap_or("")
        );
    }

    #[test]
    fn report_contains_executive_summary() {
        let report = generate_markdown_report_native(
            make_minimal_report_input(),
            "test".to_string(),
        );
        assert!(report.contains("## Executive Summary"));
        assert!(report.contains("| Suggestions Shown | 100 |"));
        assert!(report.contains("| Suggestions Accepted | 70 |"));
        assert!(report.contains("| Acceptance Rate | 70.0% |"));
        assert!(report.contains("| Chat Requests | 15 |"));
        assert!(report.contains("| Errors | 2 |"));
        assert!(report.contains("| Log Files Parsed | 5 |"));
    }

    #[test]
    fn report_includes_project_name_when_set() {
        let mut input = make_minimal_report_input();
        input.project_name = "my-project".to_string();
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("**Project:** my-project"));
    }

    #[test]
    fn report_includes_agentic_roi_when_subagent_requests_nonzero() {
        let mut input = make_minimal_report_input();
        input.subagent_requests = 50;
        input.autonomous_duration_ms = 12_540_000.0;
        input.agentic_ratio = 25.0;
        input.subagent_loops = 10;
        input.subagent_loops_started = 12;
        input.completion_rate = 83.3;
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("## Agentic ROI Summary"));
        assert!(report.contains("AI Autonomous Time"));
        assert!(report.contains("Autonomous Duration"));
        assert!(report.contains("Episode Completion Rate"));
    }

    #[test]
    fn report_omits_agentic_roi_when_no_subagent_activity() {
        let report = generate_markdown_report_native(
            make_minimal_report_input(),
            "test".to_string(),
        );
        assert!(!report.contains("## Agentic ROI Summary"));
    }

    #[test]
    fn report_includes_planning_section_when_plan_count_nonzero() {
        let mut input = make_minimal_report_input();
        input.plan_count = 10;
        input.executed_plan_count = 8;
        input.user_choices_in_plan = 3;
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("Planning & Strategic Autonomy"));
        assert!(report.contains("**Strategic Plans Proposed**: 10"));
        assert!(report.contains("**Plans Executed (Implemented)**: 8"));
        assert!(report.contains("**Planning Success Rate**: 80.0%"));
        assert!(report.contains("**In-Plan User Interactions**: 3"));
    }

    #[test]
    fn report_includes_model_efficiency_when_subagent_by_model_nonempty() {
        let mut input = make_minimal_report_input();
        input.subagent_by_model = [("gpt-4o".to_string(), 30u32)].into_iter().collect();
        input.autonomous_duration_by_model =
            [("gpt-4o".to_string(), 9_000_000.0f64)].into_iter().collect();
        input.by_chat_model = [("gpt-4o".to_string(), 100u32)].into_iter().collect();
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("## Model Efficiency"));
        assert!(report.contains("gpt-4o"));
    }

    #[test]
    fn report_contains_productivity_metrics() {
        let report = generate_markdown_report_native(
            make_minimal_report_input(),
            "test".to_string(),
        );
        assert!(report.contains("Productivity Metrics"));
        assert!(report.contains("Total Developer Time Saved"));
        assert!(report.contains("Coding Assistance"));
    }

    #[test]
    fn report_includes_agentic_autonomy_line_when_agentic_mins_provided() {
        let mut input = make_minimal_report_input();
        input.agentic_minutes_saved = 20.0;
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("Agentic Autonomy"));
    }

    #[test]
    fn report_omits_agentic_autonomy_line_when_zero() {
        let mut input = make_minimal_report_input();
        input.agentic_minutes_saved = 0.0;
        input.autonomous_duration_ms = 0.0;
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(!report.contains("Agentic Autonomy"));
    }

    #[test]
    fn report_includes_feature_signals_when_browser_tools_present() {
        let mut input = make_minimal_report_input();
        input.browser_tools_by_type =
            [("screenshot".to_string(), 2u32)].into_iter().collect();
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("VS Code 1.110 Feature Signals"));
        assert!(report.contains("### Browser Tools"));
        assert!(report.contains("**screenshot**: 2"));
    }

    #[test]
    fn normalize_model_strips_deployment_path() {
        assert_eq!(normalize_model("gpt-4o -> deployment-id"), "gpt-4o");
    }

    #[test]
    fn normalize_model_strips_colon_suffix() {
        assert_eq!(normalize_model("gpt-4o:2024-11-20"), "gpt-4o");
    }

    #[test]
    fn normalize_model_strips_copilot_suffix() {
        assert_eq!(normalize_model("gpt-41-copilot"), "gpt-41");
    }

    #[test]
    fn format_duration_ms_hours() {
        assert_eq!(format_duration_ms(7_890_000.0), "2h 11m 30s");
    }

    #[test]
    fn format_duration_ms_minutes() {
        assert_eq!(format_duration_ms(125_000.0), "2m 5s");
    }

    #[test]
    fn format_duration_ms_seconds() {
        assert_eq!(format_duration_ms(45_000.0), "45s");
    }
}
