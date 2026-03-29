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

/// Extract the date portion (YYYY-MM-DD) from a VS Code extension-host log line.
///
/// Every log line emitted by VS Code's extension host starts with a local-time
/// timestamp of the form `YYYY-MM-DD HH:MM:SS.mmm [level] …`.  This function
/// validates the first ten bytes against that pattern and returns a
/// zero-allocation `&str` slice when they match, so callers can use the result
/// directly as a `HashMap` key without extra allocation.
fn line_date_key(trimmed: &str) -> Option<&str> {
    let b = trimmed.as_bytes();
    if b.len() < 10 {
        return None;
    }
    if b[4] == b'-'
        && b[7] == b'-'
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[3].is_ascii_digit()
        && b[5].is_ascii_digit()
        && b[6].is_ascii_digit()
        && b[8].is_ascii_digit()
        && b[9].is_ascii_digit()
    {
        Some(&trimmed[0..10])
    } else {
        None
    }
}

/// Extract milliseconds-since-midnight from a log line's leading timestamp.
/// Handles "YYYY-MM-DD HH:MM:SS[.mmm]" and "YYYY-MM-DDTHH:MM:SS[.mmm]" prefixes.
/// Used to compute loop duration for `autonomous_duration_by_date`.
fn line_ts_ms(trimmed: &str) -> Option<u64> {
    let b = trimmed.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b' ' && b[10] != b'T') {
        return None;
    }
    let hour: u64 = trimmed[11..13].parse().ok()?;
    let min: u64 = trimmed[14..16].parse().ok()?;
    let sec: u64 = trimmed[17..19].parse().ok()?;
    let frac_ms: u64 = if b.len() >= 23 && b[19] == b'.' {
        trimmed[20..(20 + 3).min(b.len())].parse().unwrap_or(0)
    } else {
        0
    };
    Some(hour * 3_600_000 + min * 60_000 + sec * 1_000 + frac_ms)
}

/// Extract the two-digit hour (HH) from a VS Code log line timestamp prefix.
///
/// Expects a valid `YYYY-MM-DD` prefix (validated by [`line_date_key`]) followed
/// by a space character at byte 10 and two ASCII digits at bytes 11–12.
/// Returns `Some(&line[11..13])` or `None`.
fn line_hour_key(trimmed: &str) -> Option<&str> {
    if line_date_key(trimmed).is_none() {
        return None;
    }
    let b = trimmed.as_bytes();
    if b.len() < 13 || b[10] != b' ' || !b[11].is_ascii_digit() || !b[12].is_ascii_digit() {
        return None;
    }
    Some(&trimmed[11..13])
}

/// Extract the raw model name from a plain-text `ccreq:` success log line.
///
/// Expected format (after the optional VS Code timestamp prefix):
/// ```text
/// ccreq:HASH | success | MODEL_NAME | Nms | [INTENT]
/// ```
/// Locates the `| success |` marker case-insensitively, then returns the text
/// between that marker and the following ` | ` separator.  Callers should pass
/// the result through [`normalize_model`] before using it as a HashMap key.
/// Returns `None` when the marker is absent or the model field is empty.
fn extract_ccreq_model(trimmed: &str) -> Option<&str> {
    const MARKER: &[u8] = b"| success |";
    let b = trimmed.as_bytes();
    let pos = b.windows(MARKER.len()).position(|w| {
        w.iter()
            .zip(MARKER)
            .all(|(a, &m)| a.to_ascii_lowercase() == m)
    })?;
    let after = trimmed[pos + MARKER.len()..].trim_start();
    let end = after.find(" | ").unwrap_or(after.len());
    let model = after[..end].trim();
    if model.is_empty() { None } else { Some(model) }
}

/// Return true when the plain-text log line ends with a known subagent intent tag.
///
/// Matches `[tool/runSubagent]`, `[tool/runSubagent-*]`, `[panel/editAgent]`, and
/// `[tool/searchSubagentTool]` — the same set as `isSubagentIntent` in
/// `parserHelpers.ts`.
fn is_subagent_intent_line(trimmed: &str) -> bool {
    ascii_ci_contains(trimmed, "[tool/runsubagent")
        || ascii_ci_contains(trimmed, "[panel/editagent]")
        || ascii_ci_contains(trimmed, "[tool/searchsubagent")
}

/// Extract the finish-reason string from a `[streamChoices]` log line.
///
/// Looks for the pattern `finish reason: [XXX]` (with brackets) or
/// `finish reason: XXX` (without) and returns the trimmed inner token.
fn extract_finish_reason(trimmed: &str) -> Option<String> {
    const NEEDLE: &str = "finish reason:";
    let lower = trimmed.to_lowercase();
    let pos = lower.find(NEEDLE)?;
    let after = trimmed[pos + NEEDLE.len()..].trim_start();
    let reason = if after.starts_with('[') {
        let end = after.find(']')?;
        &after[1..end]
    } else {
        let end = after
            .find(|c: char| c.is_whitespace() || c == ']')
            .unwrap_or(after.len());
        &after[..end]
    };
    let reason = reason.trim().to_string();
    if reason.is_empty() { None } else { Some(reason) }
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
        lines_parsed: 0,
        json_lines: 0,
        by_chat_model: HashMap::new(),
        subagent_by_model: HashMap::new(),
        autonomous_duration_by_model: HashMap::new(),
        chat_by_date: HashMap::new(),
        finish_reason_counts: HashMap::new(),
        subagent_loops_started: 0,
        total_rejected: 0,
        loops_completed_by_model: HashMap::new(),
        total_loop_actions_by_model: HashMap::new(),
        loops_started_by_model: HashMap::new(),
        loops_started_by_date: HashMap::new(),
        loops_completed_by_date: HashMap::new(),
        total_loop_actions_by_date: HashMap::new(),
        autonomous_duration_by_date: HashMap::new(),
    };

    // Stateful loop-tracking: detect subagent loop starts and stops.
    // This state is local to a single parse_lines call (one file), which is
    // sufficient because Copilot Chat sessions are generally contained within
    // one log file.
    let mut active_loop = false;
    let mut active_loop_model: Option<String> = None;
    let mut active_loop_action_count: u32 = 0;
    let mut active_loop_start_ms: Option<u64> = None;

    for line in lines {
        let trimmed = line.as_ref().trim();
        if trimmed.is_empty() {
            continue;
        }
        stats.lines_parsed += 1;

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

                let ts_opt = entry.time.as_deref();
                let date_key: Option<&str> = ts_opt.and_then(|ts| {
                    if ts.len() >= 10 { Some(&ts[0..10]) } else { None }
                });
                let hour_key: Option<&str> = ts_opt.and_then(|ts| {
                    if ts.len() >= 13 { Some(&ts[11..13]) } else { None }
                });

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
                    if !resolved_model.is_empty() {
                        let model_key = normalize_model(resolved_model);
                        *stats.by_chat_model.entry(model_key).or_insert(0) += 1;
                    }
                    if let Some(dk) = date_key {
                        *stats.chat_by_date.entry(dk.to_string()).or_insert(0) += 1;
                    }
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

                stats.json_lines += 1;
                continue;
            }
        }

        // ── Plain-text path ────────────────────────────────────────────────
        if ascii_ci_contains(trimmed, "[fetchcompletions]") {
            // e.g. "[fetchCompletions] ... finished with 200 status after Nms"
            if ascii_ci_contains(trimmed, "finished with")
                && ascii_ci_contains(trimmed, "200")
            {
                stats.total_shown += 1;
                // Populate per-date and per-hour maps for the timeline chart.
                if let Some(dk) = line_date_key(trimmed) {
                    stats.by_date.entry(dk.to_string()).or_default().shown += 1;
                }
                if let Some(hk) = line_hour_key(trimmed) {
                    *stats.by_hour.entry(hk.to_string()).or_insert(0) += 1;
                }
                if let Some(lat) = extract_latency_from_text(trimmed) {
                    stats.latencies.push(lat);
                }
            }
        } else if ascii_ci_contains(trimmed, "ccreq:")
            && ascii_ci_contains(trimmed, "| success |")
        {
            // e.g. "YYYY-MM-DD HH:MM:SS.mmm [info] ccreq:HASH | success | MODEL | Nms | [INTENT]"
            let lat = extract_latency_from_text(trimmed);
            if ascii_ci_contains(trimmed, "[xtabprovider]") {
                // Inline-completion suggestion shown
                stats.total_shown += 1;
                // Populate per-date, per-hour, and per-model maps.
                if let Some(dk) = line_date_key(trimmed) {
                    stats.by_date.entry(dk.to_string()).or_default().shown += 1;
                }
                if let Some(hk) = line_hour_key(trimmed) {
                    *stats.by_hour.entry(hk.to_string()).or_insert(0) += 1;
                }
                if let Some(raw_model) = extract_ccreq_model(trimmed) {
                    let norm = normalize_model(raw_model);
                    if !norm.is_empty() {
                        *stats.by_model_shown.entry(norm).or_insert(0) += 1;
                    }
                }
                if let Some(l) = lat {
                    stats.latencies.push(l);
                }
            } else if ascii_ci_contains(trimmed, "[nes.") {
                // Inline-completion accepted (e.g. [nes.nextCursorPosition])
                stats.total_accepted += 1;
                // Populate per-date and per-model maps.
                if let Some(dk) = line_date_key(trimmed) {
                    stats.by_date.entry(dk.to_string()).or_default().accepted += 1;
                }
                if let Some(raw_model) = extract_ccreq_model(trimmed) {
                    let norm = normalize_model(raw_model);
                    if !norm.is_empty() {
                        *stats.by_model_accepted.entry(norm).or_insert(0) += 1;
                    }
                }
                if let Some(l) = lat {
                    stats.latencies.push(l);
                }
            } else {
                // Chat / agentic request
                stats.total_chat += 1;
                // Extract and normalise the model name for per-model chat tracking.
                let norm_model = extract_ccreq_model(trimmed)
                    .map(|raw| normalize_model(raw))
                    .filter(|m| !m.is_empty());
                if let Some(ref m) = norm_model {
                    *stats.by_chat_model.entry(m.clone()).or_insert(0) += 1;
                }
                // Per-date chat count for the timeline chart.
                if let Some(dk) = line_date_key(trimmed) {
                    *stats.chat_by_date.entry(dk.to_string()).or_insert(0) += 1;
                }
                // Detect subagent (agentic) intents for autonomous-ratio tracking.
                let is_agentic = is_subagent_intent_line(trimmed);
                if is_agentic {
                    stats.subagent_requests += 1;
                    if let Some(ref m) = norm_model {
                        *stats.subagent_by_model.entry(m.clone()).or_insert(0) += 1;
                    }
                    // Track the first request in a new loop as a loop-start.
                    if !active_loop {
                        stats.subagent_loops_started += 1;
                        active_loop = true;
                        active_loop_model = norm_model.clone();
                        active_loop_action_count = 1;
                        if let Some(ref m) = norm_model {
                            *stats.loops_started_by_model.entry(m.clone()).or_insert(0) += 1;
                        }
                        if let Some(dk) = line_date_key(trimmed) {
                            *stats.loops_started_by_date.entry(dk.to_string()).or_insert(0) += 1;
                        }
                        active_loop_start_ms = line_ts_ms(trimmed);
                    } else {
                        active_loop_action_count += 1;
                    }
                }
                // Always record latency for overall P50/P95 tracking.
                if let Some(l) = lat {
                    stats.latencies.push(l);
                    // Accumulate autonomous duration for agentic intents and
                    // track per-model autonomous duration via request latency.
                    let is_agentic_duration = is_agentic
                        || ascii_ci_contains(trimmed, "[panel/")
                        || ascii_ci_contains(trimmed, "/agent]")
                        || ascii_ci_contains(trimmed, "subagent");
                    if is_agentic_duration {
                        stats.autonomous_duration_ms += l as f64;
                        if let Some(ref m) = norm_model {
                            *stats
                                .autonomous_duration_by_model
                                .entry(m.clone())
                                .or_insert(0.0) += l as f64;
                        }
                    }
                }
            }
        } else if ascii_ci_contains(trimmed, "[streamchoices]")
            && ascii_ci_contains(trimmed, "finish reason:")
        {
            // "[streamChoices] solution N returned. finish reason: [XXX]"
            if let Some(reason) = extract_finish_reason(trimmed) {
                *stats.finish_reason_counts.entry(reason).or_insert(0) += 1;
            }
        } else if ascii_ci_contains(trimmed, "[asynccompletionmanager]")
            && ascii_ci_contains(trimmed, "aborterror")
        {
            // "[AsyncCompletionManager] ... AbortError" — user rejected completion.
            stats.total_rejected += 1;
        } else if ascii_ci_contains(trimmed, "[toolcallingloop]")
            && ascii_ci_contains(trimmed, "shouldcontinue=false")
        {
            // "[ToolCallingLoop] shouldContinue=false" — episode complete.
            if active_loop {
                stats.subagent_loops += 1;
                if let Some(ref m) = active_loop_model {
                    *stats.loops_completed_by_model.entry(m.clone()).or_insert(0) += 1;
                    *stats.total_loop_actions_by_model.entry(m.clone()).or_insert(0) +=
                        active_loop_action_count;
                }
                if let Some(dk) = line_date_key(trimmed) {
                    let dk = dk.to_string();
                    *stats.loops_completed_by_date.entry(dk.clone()).or_insert(0) += 1;
                    *stats
                        .total_loop_actions_by_date
                        .entry(dk.clone())
                        .or_insert(0) += active_loop_action_count;
                    if let (Some(start_ms), Some(end_ms)) =
                        (active_loop_start_ms, line_ts_ms(trimmed))
                    {
                        if end_ms > start_ms {
                            *stats
                                .autonomous_duration_by_date
                                .entry(dk)
                                .or_insert(0.0) += (end_ms - start_ms) as f64;
                        }
                    }
                }
                active_loop = false;
                active_loop_model = None;
                active_loop_action_count = 0;
                active_loop_start_ms = None;
            }
        }
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
/// Returns a NAPI `Error` if the file cannot be opened.
#[napi]
pub fn parse_log_file_native(path: String) -> napi::Result<NativeStats> {
    let file = File::open(&path)
        .map_err(|e| napi::Error::from_reason(format!("Failed to open {path}: {e}")))?;
    let reader = BufReader::new(file);
    let lines = reader.lines().filter_map(|l| l.ok());
    Ok(parse_lines(lines))
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
    fn counts_plain_text_ccreq_xtab_shown() {
        // [XtabProvider] lines are inline-completion suggestions (shown).
        let input = "2024-06-01 15:10:17.693 [info] ccreq:abc123 | success | gpt-4o | 800ms | [XtabProvider]";
        let s = parse(input);
        assert_eq!(s.total_shown, 1);
        assert_eq!(s.total_accepted, 0);
        assert_eq!(s.total_chat, 0);
    }

    #[test]
    fn counts_plain_text_ccreq_chat() {
        // Non-completion intent lines are counted as chat.
        let input = "2024-06-01 15:10:17.693 [info] ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]";
        let s = parse(input);
        assert_eq!(s.total_chat, 1);
        assert_eq!(s.total_shown, 0);
        assert_eq!(s.total_accepted, 0);
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
        let input = "[fetchCompletions] Request to /v1/engines/gpt-4.5/completions finished with 200 status after 290ms";
        let s = parse(input);
        assert_eq!(s.latencies.first(), Some(&290));
    }

    #[test]
    fn collects_latency_from_text_ccreq() {
        // [XtabProvider] lines are classified as shown — latency is collected.
        let input = "2024-06-01 15:10:17.693 [info] ccreq:abc123 | success | gpt-4o | 800ms | [XtabProvider]";
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
        assert_eq!(s.lines_parsed, 0);
        assert_eq!(s.json_lines, 0);
    }

    // ── Helper function unit tests ────────────────────────────────────────────

    #[test]
    fn line_date_key_extracts_prefix() {
        assert_eq!(
            line_date_key("2026-03-27 15:10:17.693 [info] ccreq:abc"),
            Some("2026-03-27")
        );
    }

    #[test]
    fn line_date_key_returns_none_for_non_dated_line() {
        assert!(line_date_key("[fetchCompletions] Request finished").is_none());
        assert!(line_date_key("").is_none());
        assert!(line_date_key("2026/03/27 bad-separator").is_none());
    }

    #[test]
    fn line_hour_key_extracts_two_digit_hour() {
        assert_eq!(
            line_hour_key("2026-03-27 09:10:17.693 [info] ccreq:abc"),
            Some("09")
        );
        assert_eq!(
            line_hour_key("2026-03-27 15:10:17.693 [info] ccreq:abc"),
            Some("15")
        );
    }

    #[test]
    fn line_hour_key_returns_none_for_non_dated_line() {
        assert!(line_hour_key("[fetchCompletions] Request").is_none());
    }

    #[test]
    fn extract_ccreq_model_returns_model_name() {
        let line = "2026-03-27 15:10:17.693 [info] ccreq:24140080.copilotmd | success | copilot-nes-oct | 850ms | [XtabProvider]";
        assert_eq!(extract_ccreq_model(line), Some("copilot-nes-oct"));
    }

    #[test]
    fn extract_ccreq_model_case_insensitive_marker() {
        let line = "ccreq:abc | SUCCESS | my-model | 100ms | [intent]";
        assert_eq!(extract_ccreq_model(line), Some("my-model"));
    }

    #[test]
    fn extract_ccreq_model_returns_none_when_no_marker() {
        assert!(extract_ccreq_model("ccreq:abc | my-model | 100ms").is_none());
    }

    // ── Plain-text path: by_date / by_model / by_hour population ─────────────

    #[test]
    fn plain_text_xtabprovider_populates_by_date() {
        let line = "2026-03-27 15:10:17.693 [info] ccreq:24140080.copilotmd | success | copilot-nes-oct | 850ms | [XtabProvider]";
        let s = parse(line);
        assert_eq!(s.by_date.get("2026-03-27").map(|d| d.shown), Some(1));
        assert_eq!(s.by_date.get("2026-03-27").map(|d| d.accepted), Some(0));
    }

    #[test]
    fn plain_text_xtabprovider_populates_by_hour() {
        let line = "2026-03-27 15:10:17.693 [info] ccreq:24140080.copilotmd | success | copilot-nes-oct | 850ms | [XtabProvider]";
        let s = parse(line);
        assert_eq!(s.by_hour.get("15"), Some(&1));
    }

    #[test]
    fn plain_text_xtabprovider_populates_by_model_shown() {
        let line = "2026-03-27 15:10:17.693 [info] ccreq:24140080.copilotmd | success | copilot-nes-oct | 850ms | [XtabProvider]";
        let s = parse(line);
        assert_eq!(s.by_model_shown.get("copilot-nes-oct"), Some(&1));
        assert!(s.by_model_accepted.is_empty());
    }

    #[test]
    fn plain_text_nes_populates_by_date_accepted() {
        let line = "2026-03-27 15:10:21.164 [info] ccreq:b0062305.copilotmd | success | copilot-suggestions-himalia-001 | 682ms | [nes.nextCursorPosition]";
        let s = parse(line);
        assert_eq!(s.by_date.get("2026-03-27").map(|d| d.accepted), Some(1));
        assert_eq!(s.by_date.get("2026-03-27").map(|d| d.shown), Some(0));
    }

    #[test]
    fn plain_text_nes_populates_by_model_accepted() {
        let line = "2026-03-27 15:10:21.164 [info] ccreq:b0062305.copilotmd | success | copilot-suggestions-himalia-001 | 682ms | [nes.nextCursorPosition]";
        let s = parse(line);
        assert_eq!(
            s.by_model_accepted.get("copilot-suggestions-himalia-001"),
            Some(&1)
        );
        assert!(s.by_model_shown.is_empty());
    }

    #[test]
    fn plain_text_fetch_completions_populates_by_date() {
        let line = "2026-03-27 15:10:32.573 [info] [fetchCompletions] Request to /v1/completions finished with 200 status after 198ms";
        let s = parse(line);
        assert_eq!(s.by_date.get("2026-03-27").map(|d| d.shown), Some(1));
        assert_eq!(s.by_hour.get("15"), Some(&1));
    }

    #[test]
    fn lines_parsed_and_json_lines_counts() {
        let input = concat!(
            r#"{"event":"ghost-text/shown","modelId":"gpt-4o"}"#,
            "\n",
            "2026-03-27 15:10:17.693 [info] ccreq:abc | success | gpt-4o | 100ms | [XtabProvider]",
            "\n\n",
        );
        let s = parse(input);
        assert_eq!(s.lines_parsed, 2);
        assert_eq!(s.json_lines, 1);
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

    // ── New fields: by_chat_model, subagent_by_model, autonomous_duration_by_model ──

    #[test]
    fn is_subagent_intent_line_matches_known_intents() {
        assert!(is_subagent_intent_line(
            "2026-03-27 12:00:00 ccreq:abc | success | gpt-4o | 500ms | [tool/runSubagent]"
        ));
        assert!(is_subagent_intent_line(
            "2026-03-27 12:00:00 ccreq:abc | success | gpt-4o | 500ms | [panel/editAgent]"
        ));
        assert!(is_subagent_intent_line(
            "2026-03-27 12:00:00 ccreq:abc | success | gpt-4o | 500ms | [tool/runSubagent-some-task]"
        ));
        assert!(is_subagent_intent_line(
            "2026-03-27 12:00:00 ccreq:abc | success | gpt-4o | 500ms | [tool/searchSubagentTool]"
        ));
        assert!(!is_subagent_intent_line(
            "2026-03-27 12:00:00 ccreq:abc | success | gpt-4o | 500ms | [vscodePrompt]"
        ));
        assert!(!is_subagent_intent_line(
            "2026-03-27 12:00:00 ccreq:abc | success | gpt-4o | 500ms | [XtabProvider]"
        ));
    }

    #[test]
    fn extract_finish_reason_with_brackets() {
        assert_eq!(
            extract_finish_reason("[streamChoices] solution 0 returned. finish reason: [stop]"),
            Some("stop".to_string())
        );
        assert_eq!(
            extract_finish_reason("[streamChoices] finish reason: [length]"),
            Some("length".to_string())
        );
    }

    #[test]
    fn extract_finish_reason_without_brackets() {
        assert_eq!(
            extract_finish_reason("[streamChoices] finish reason: stop"),
            Some("stop".to_string())
        );
    }

    #[test]
    fn extract_finish_reason_returns_none_when_absent() {
        assert!(extract_finish_reason("[streamChoices] solution returned").is_none());
        assert!(extract_finish_reason("unrelated line").is_none());
    }

    #[test]
    fn plain_text_chat_ccreq_populates_by_chat_model() {
        let line = "2026-03-27 12:00:00 [info] ccreq:abc | success | gpt-4o | 300ms | [vscodePrompt]";
        let s = parse(line);
        assert_eq!(s.total_chat, 1);
        assert_eq!(s.by_chat_model.get("gpt-4o"), Some(&1));
        assert_eq!(s.chat_by_date.get("2026-03-27"), Some(&1));
    }

    #[test]
    fn plain_text_subagent_ccreq_populates_subagent_by_model() {
        let line = "2026-03-27 12:00:00 [info] ccreq:abc | success | claude-3.5-sonnet | 800ms | [tool/runSubagent]";
        let s = parse(line);
        assert_eq!(s.subagent_requests, 1);
        assert_eq!(s.subagent_by_model.get("claude-3.5-sonnet"), Some(&1));
        assert_eq!(s.by_chat_model.get("claude-3.5-sonnet"), Some(&1));
        assert_eq!(s.chat_by_date.get("2026-03-27"), Some(&1));
        assert!(s.autonomous_duration_by_model.get("claude-3.5-sonnet").is_some_and(|&v| v > 0.0));
    }

    #[test]
    fn plain_text_subagent_ccreq_does_not_double_count_in_chat() {
        // subagent requests are also counted as chat — only one chat increment per line.
        let line = "2026-03-27 12:00:00 [info] ccreq:abc | success | gpt-4o | 200ms | [panel/editAgent]";
        let s = parse(line);
        assert_eq!(s.total_chat, 1);
        assert_eq!(s.subagent_requests, 1);
        assert_eq!(s.by_chat_model.get("gpt-4o"), Some(&1));
    }

    #[test]
    fn json_chat_request_populates_by_chat_model_and_chat_by_date() {
        let input = r#"{"event":"copilot/chat-request","modelId":"gpt-4o","time":"2026-03-27T10:00:00Z"}"#;
        let s = parse(input);
        assert_eq!(s.total_chat, 1);
        assert_eq!(s.by_chat_model.get("gpt-4o"), Some(&1));
        assert_eq!(s.chat_by_date.get("2026-03-27"), Some(&1));
    }

    #[test]
    fn finish_reason_counts_stop_and_length() {
        let input = concat!(
            "2026-03-27 12:00:00 [streamChoices] solution 0 returned. finish reason: [stop]\n",
            "2026-03-27 12:00:00 [streamChoices] solution 0 returned. finish reason: [stop]\n",
            "2026-03-27 12:00:00 [streamChoices] solution 0 returned. finish reason: [length]\n",
        );
        let s = parse(input);
        assert_eq!(s.finish_reason_counts.get("stop"), Some(&2));
        assert_eq!(s.finish_reason_counts.get("length"), Some(&1));
    }

    #[test]
    fn abort_error_increments_total_rejected() {
        let input = concat!(
            "12:00:00 [AsyncCompletionManager] Completion request aborted: AbortError: aborted\n",
            "12:00:00 [AsyncCompletionManager] Another abort: AbortError\n",
        );
        let s = parse(input);
        assert_eq!(s.total_rejected, 2);
    }

    #[test]
    fn tool_calling_loop_stop_increments_subagent_loops() {
        let input = concat!(
            "2026-03-27 12:00:00 ccreq:a | success | gpt-4o | 200ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:01 [ToolCallingLoop] Subagent stop hook result: shouldContinue=false\n",
        );
        let s = parse(input);
        assert_eq!(s.subagent_loops_started, 1);
        assert_eq!(s.subagent_loops, 1);
    }

    #[test]
    fn multiple_loops_tracked_correctly() {
        let input = concat!(
            // Loop 1
            "2026-03-27 12:00:00 ccreq:a | success | gpt-4o | 200ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:01 ccreq:b | success | gpt-4o | 150ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:02 [ToolCallingLoop] shouldContinue=false\n",
            // Loop 2
            "2026-03-27 12:01:00 ccreq:c | success | gpt-4o | 300ms | [panel/editAgent]\n",
            "2026-03-27 12:01:01 [ToolCallingLoop] shouldContinue=false\n",
        );
        let s = parse(input);
        assert_eq!(s.subagent_loops_started, 2);
        assert_eq!(s.subagent_loops, 2);
        // 3 subagent requests (a, b, c)
        assert_eq!(s.subagent_requests, 3);
    }

    #[test]
    fn new_fields_zero_when_empty_input() {
        let s = parse("");
        assert!(s.by_chat_model.is_empty());
        assert!(s.subagent_by_model.is_empty());
        assert!(s.autonomous_duration_by_model.is_empty());
        assert!(s.chat_by_date.is_empty());
        assert!(s.finish_reason_counts.is_empty());
        assert_eq!(s.subagent_loops_started, 0);
        assert_eq!(s.total_rejected, 0);
        assert!(s.loops_completed_by_model.is_empty());
        assert!(s.total_loop_actions_by_model.is_empty());
        assert!(s.loops_started_by_model.is_empty());
    }

    #[test]
    fn loops_completed_by_model_tracks_per_model_depth() {
        // gpt-4o loop: 2 actions then stops
        // claude loop: 1 action then stops
        let input = concat!(
            "2026-03-27 12:00:00 ccreq:a | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:01 ccreq:b | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:02 [ToolCallingLoop] shouldContinue=false\n",
            "2026-03-27 12:01:00 ccreq:c | success | claude-3.5-sonnet | 200ms | [tool/runSubagent]\n",
            "2026-03-27 12:01:01 [ToolCallingLoop] shouldContinue=false\n",
        );
        let s = parse(input);
        assert_eq!(s.loops_completed_by_model.get("gpt-4o"), Some(&1));
        assert_eq!(s.total_loop_actions_by_model.get("gpt-4o"), Some(&2));
        assert_eq!(s.loops_completed_by_model.get("claude-3.5-sonnet"), Some(&1));
        assert_eq!(s.total_loop_actions_by_model.get("claude-3.5-sonnet"), Some(&1));
    }

    #[test]
    fn loop_without_stop_not_counted_in_completed() {
        // Loop started but never stopped — should not appear in loops_completed_by_model
        let input =
            "2026-03-27 12:00:00 ccreq:a | success | gpt-4o | 100ms | [tool/runSubagent]\n";
        let s = parse(input);
        assert_eq!(s.subagent_loops_started, 1);
        assert_eq!(s.subagent_loops, 0);
        assert!(s.loops_completed_by_model.is_empty());
        assert!(s.total_loop_actions_by_model.is_empty());
    }

    #[test]
    fn loops_started_by_model_tracks_per_model() {
        // Two loops started: gpt-4o starts and stops, then claude starts (no stop).
        let input = concat!(
            "2026-03-27 12:00:00 ccreq:a | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:01 ccreq:b | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:02 [ToolCallingLoop] shouldContinue=false\n",
            "2026-03-27 12:01:00 ccreq:c | success | claude-3.5-sonnet | 200ms | [tool/runSubagent]\n",
        );
        let s = parse(input);
        // gpt-4o started 1 loop, claude started 1 loop
        assert_eq!(s.loops_started_by_model.get("gpt-4o"), Some(&1));
        assert_eq!(s.loops_started_by_model.get("claude-3.5-sonnet"), Some(&1));
        // global counter matches
        assert_eq!(s.subagent_loops_started, 2);
    }

    #[test]
    fn loops_started_by_date_tracks_per_date() {
        let input = concat!(
            "2026-03-27 12:00:00 ccreq:a | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:01 [ToolCallingLoop] shouldContinue=false\n",
            "2026-03-28 09:00:00 ccreq:b | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-28 09:00:01 [ToolCallingLoop] shouldContinue=false\n",
            "2026-03-28 10:00:00 ccreq:c | success | claude-3.5-sonnet | 200ms | [tool/runSubagent]\n",
            "2026-03-28 10:00:02 [ToolCallingLoop] shouldContinue=false\n",
        );
        let s = parse(input);
        assert_eq!(s.loops_started_by_date.get("2026-03-27"), Some(&1));
        assert_eq!(s.loops_started_by_date.get("2026-03-28"), Some(&2));
        assert_eq!(s.loops_completed_by_date.get("2026-03-27"), Some(&1));
        assert_eq!(s.loops_completed_by_date.get("2026-03-28"), Some(&2));
        assert_eq!(s.total_loop_actions_by_date.get("2026-03-27"), Some(&1));
        assert_eq!(s.total_loop_actions_by_date.get("2026-03-28"), Some(&2)); // 1+1 actions
    }

    #[test]
    fn autonomous_duration_by_date_computed_from_timestamps() {
        let input = concat!(
            "2026-03-27 12:00:00.000 ccreq:a | success | gpt-4o | 100ms | [tool/runSubagent]\n",
            "2026-03-27 12:00:05.000 [ToolCallingLoop] shouldContinue=false\n",
        );
        let s = parse(input);
        // Duration = 5000 ms (12:00:05 - 12:00:00)
        let dur = s.autonomous_duration_by_date.get("2026-03-27").copied().unwrap_or(0.0);
        assert!((dur - 5000.0).abs() < 1.0, "expected ~5000ms, got {}", dur);
    }

    #[test]
    fn line_ts_ms_parses_space_separated_timestamp() {
        // 12:00:05 should be 12*3600000 + 5000 = 43_205_000
        assert_eq!(
            line_ts_ms("2026-03-27 12:00:05 some text"),
            Some(43_205_000)
        );
    }

    #[test]
    fn line_ts_ms_parses_fractional_seconds() {
        // 12:00:05.123
        assert_eq!(
            line_ts_ms("2026-03-27 12:00:05.123 some text"),
            Some(43_205_123)
        );
    }

    #[test]
    fn line_ts_ms_returns_none_for_non_timestamp_line() {
        assert_eq!(line_ts_ms("[ToolCallingLoop] shouldContinue=false"), None);
        assert_eq!(line_ts_ms("short"), None);
    }
}
