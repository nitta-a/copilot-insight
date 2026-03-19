#![deny(clippy::all)]

use napi_derive::napi;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

/// Per-date shown/accepted counts returned as a NAPI-RS object.
#[napi(object)]
#[derive(Default, Clone)]
pub struct NativeDateStat {
    pub shown: u32,
    pub accepted: u32,
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
    };

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

                continue;
            }
        }

        // ── Plain-text path ────────────────────────────────────────────────
        if ascii_ci_contains(trimmed, "[fetchcompletions]")
            || ascii_ci_contains(trimmed, "ccreq:")
        {
            stats.total_shown += 1;
            if let Some(lat) = extract_latency_from_text(trimmed) {
                stats.latencies.push(lat);
            }
        }
    }

    stats
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
    }
}
