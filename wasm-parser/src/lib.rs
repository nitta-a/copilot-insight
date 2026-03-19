use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Per-date shown/accepted counts.
#[derive(Serialize, Default)]
pub struct WasmDateStat {
    pub shown: usize,
    pub accepted: usize,
}

/// Aggregated statistics produced by parsing a log chunk.
#[derive(Serialize)]
pub struct WasmStats {
    /// Number of inline-completion suggestions shown to the user.
    pub total_shown: usize,
    /// Number of inline-completion suggestions accepted by the user.
    pub total_accepted: usize,
    /// Number of chat requests made.
    pub total_chat: usize,
    /// Number of subagent-initiated requests detected.
    pub subagent_requests: usize,
    /// Number of agent plan-proposal events detected.
    pub plan_count: usize,
    /// Per-model count of shown inline completions.
    pub by_model_shown: HashMap<String, usize>,
    /// Per-model count of accepted inline completions.
    pub by_model_accepted: HashMap<String, usize>,
    /// Per-date shown/accepted counts (key: "YYYY-MM-DD").
    pub by_date: HashMap<String, WasmDateStat>,
    /// Per-hour event counts (key: "HH", 00–23).
    pub by_hour: HashMap<String, usize>,
    /// Raw inline-completion latency values in milliseconds.
    pub latencies: Vec<u32>,
    /// Per context-source occurrence counts.
    pub by_context_source: HashMap<String, usize>,
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
/// no heap allocation is needed (unlike `str::to_lowercase`).  Both
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
    // Scan backwards through the bytes looking for a "ms" suffix preceded by
    // ASCII digits.  A backward scan finds the last occurrence, which matches
    // the `after <N>ms` pattern used in fetchCompletions log lines.
    let bytes = line.as_bytes();
    let mut i = bytes.len();
    while i >= 2 {
        i -= 1;
        if bytes[i] == b's' && bytes[i - 1] == b'm' {
            // Found "ms" — collect preceding digits.
            let ms_pos = i - 1; // index of 'm'
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

/// Parse a log chunk and return a JSON-serialised [`WasmStats`].
///
/// Each non-empty line is classified as either a plain-text log entry or a
/// JSON-embedded entry.
///
/// **Plain-text detection** (uses borrowed `&str` slices to avoid copies):
/// - Lines containing `[fetchcompletions]` or `ccreq:` are counted as
///   `total_shown`.  A `<N>ms` latency suffix is extracted when present.
///
/// **JSON detection** (fields extracted via `serde_json`):
/// - `event` / `eventName` containing `"shown"`, `"displayed"`, or
///   `"triggered"` → `total_shown` + per-model map + per-date map + per-hour
///   map.
/// - `event` / `eventName` containing `"accepted"` (and not shown) →
///   `total_accepted` + per-model map + per-date map.
/// - `event` / `eventName` containing `"chat-request"`, `"chat.request"`,
///   or `"chat/request"` → `total_chat`.
/// - `event` / `eventName` containing `"subagent-request"` or
///   `"subagent/request"` → `subagent_requests`.
/// - `event` / `eventName` containing `"plan-proposed"` or
///   `"plan/proposed"` → `plan_count`.
/// - `latencyMs` → appended to `latencies`.
/// - `context_source` → incremented in `by_context_source`.
/// - `time` / `timestamp` → date key (`YYYY-MM-DD`) used for `by_date`;
///   hour key (`HH`) used for `by_hour`.
///
/// Model names are resolved from the first non-empty field in the priority
/// order: `model_name` → `modelId` → `model` → `engineId` → `engineName`
/// → `engine`.
#[wasm_bindgen]
pub fn parse_log_chunk(input: &str) -> String {
    let mut stats = WasmStats {
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

    for line in input.lines() {
        let trimmed = line.trim();
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

                // Resolve model name using priority order (borrowing to avoid copies).
                let resolved_model: &str = entry
                    .model_name
                    .as_deref()
                    .or(entry.model_id.as_deref())
                    .or(entry.model.as_deref())
                    .or(entry.engine_id.as_deref())
                    .or(entry.engine_name.as_deref())
                    .or(entry.engine.as_deref())
                    .unwrap_or("");

                // Extract date ("YYYY-MM-DD") and hour ("HH") from timestamp
                // using cheap string slicing — no allocations beyond the key.
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
                        *stats.by_model_shown.entry(resolved_model.to_string()).or_insert(0) += 1;
                    }
                    if let Some(dk) = date_key {
                        stats.by_date.entry(dk.to_string()).or_default().shown += 1;
                    }
                    if let Some(hk) = hour_key {
                        *stats.by_hour.entry(hk.to_string()).or_insert(0) += 1;
                    }
                } else if is_accepted {
                    stats.total_accepted += 1;
                    if !resolved_model.is_empty() {
                        *stats.by_model_accepted.entry(resolved_model.to_string()).or_insert(0) += 1;
                    }
                    if let Some(dk) = date_key {
                        stats.by_date.entry(dk.to_string()).or_default().accepted += 1;
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

                // Latency — collected regardless of event type.
                if let Some(lat) = entry.latency_ms {
                    stats.latencies.push(lat);
                }

                // Context source — collected regardless of event type.
                if let Some(src) = entry.context_source.as_deref() {
                    if !src.is_empty() {
                        *stats.by_context_source.entry(src.to_string()).or_insert(0) += 1;
                    }
                }

                continue;
            }
        }

        // ── Plain-text path ────────────────────────────────────────────────
        // Use byte-by-byte ASCII comparison to avoid allocating a lowercase copy
        // for every non-JSON line (patterns are pure ASCII).
        if ascii_ci_contains(trimmed, "[fetchcompletions]") || ascii_ci_contains(trimmed, "ccreq:") {
            stats.total_shown += 1;
            // Attempt to extract a latency value (e.g. "after 290ms").
            if let Some(lat) = extract_latency_from_text(trimmed) {
                stats.latencies.push(lat);
            }
        }
    }

    serde_json::to_string(&stats).unwrap_or_else(|_| {
        r#"{"total_shown":0,"total_accepted":0,"total_chat":0,"subagent_requests":0,"plan_count":0,"by_model_shown":{},"by_model_accepted":{},"by_date":{},"by_hour":{},"latencies":[],"by_context_source":{}}"#.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(input: &str) -> serde_json::Value {
        serde_json::from_str(&parse_log_chunk(input)).expect("valid JSON output")
    }

    #[test]
    fn empty_input_returns_zeros() {
        let v = parse("");
        assert_eq!(v["total_shown"], 0);
        assert_eq!(v["total_accepted"], 0);
        assert_eq!(v["total_chat"], 0);
        assert_eq!(v["subagent_requests"], 0);
        assert_eq!(v["plan_count"], 0);
    }

    #[test]
    fn skips_blank_lines() {
        let v = parse("\n\n  \n");
        assert_eq!(v["total_shown"], 0);
        assert_eq!(v["total_accepted"], 0);
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
        let v = parse(input);
        assert_eq!(v["total_shown"], 2);
        assert_eq!(v["total_accepted"], 1);
        assert_eq!(v["by_model_shown"]["gpt-4o"], 1);
        assert_eq!(v["by_model_accepted"]["gpt-4o"], 1);
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
        let v = parse(input);
        assert_eq!(v["total_chat"], 1);
        assert_eq!(v["subagent_requests"], 1);
        assert_eq!(v["plan_count"], 1);
    }

    #[test]
    fn handles_embedded_json() {
        let input = r#"2024-06-01 [info] {"event":"ghost-text/shown","modelId":"gpt-4o"}"#;
        let v = parse(input);
        assert_eq!(v["total_shown"], 1);
        assert_eq!(v["by_model_shown"]["gpt-4o"], 1);
    }

    #[test]
    fn counts_plain_text_fetch_completions() {
        let input = "[fetchCompletions] Request to /v1/engines/gpt-4.5/completions finished with 200 status after 290ms";
        let v = parse(input);
        assert_eq!(v["total_shown"], 1);
    }

    #[test]
    fn counts_plain_text_ccreq() {
        let input = "2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]";
        let v = parse(input);
        assert_eq!(v["total_shown"], 1);
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
        let v = parse(input);
        assert_eq!(v["total_shown"], 3);
        assert_eq!(v["total_accepted"], 1);
        assert_eq!(v["by_model_shown"]["gpt-4o"], 2);
        assert_eq!(v["by_model_shown"]["claude-3.5-sonnet"], 1);
        assert_eq!(v["by_model_accepted"]["gpt-4o"], 1);
    }

    #[test]
    fn uses_event_name_fallback() {
        let input = r#"{"eventName":"ghost-text/shown","model":"gemini-pro"}"#;
        let v = parse(input);
        assert_eq!(v["total_shown"], 1);
        assert_eq!(v["by_model_shown"]["gemini-pro"], 1);
    }

    #[test]
    fn model_priority_order() {
        // model_name should take precedence over modelId
        let input = r#"{"event":"ghost-text/shown","model_name":"priority-model","modelId":"fallback-model"}"#;
        let v = parse(input);
        assert_eq!(v["by_model_shown"]["priority-model"], 1);
        assert_eq!(v["by_model_shown"].get("fallback-model"), None);
    }

    // ── New-field tests ───────────────────────────────────────────────────

    #[test]
    fn populates_by_date_and_by_hour_for_shown() {
        let input = r#"{"event":"ghost-text/shown","modelId":"gpt-4o","time":"2024-06-15T14:32:00Z"}"#;
        let v = parse(input);
        assert_eq!(v["by_date"]["2024-06-15"]["shown"], 1);
        assert_eq!(v["by_date"]["2024-06-15"]["accepted"], 0);
        assert_eq!(v["by_hour"]["14"], 1);
    }

    #[test]
    fn populates_by_date_for_accepted() {
        let input = concat!(
            r#"{"event":"ghost-text/shown","time":"2024-06-15T09:00:00Z"}"#,
            "\n",
            r#"{"event":"ghost-text/accepted","time":"2024-06-15T09:01:00Z"}"#,
        );
        let v = parse(input);
        assert_eq!(v["by_date"]["2024-06-15"]["shown"], 1);
        assert_eq!(v["by_date"]["2024-06-15"]["accepted"], 1);
    }

    #[test]
    fn accepts_timestamp_alias() {
        // "timestamp" should be treated the same as "time"
        let input = r#"{"event":"ghost-text/shown","timestamp":"2024-07-01T08:00:00Z"}"#;
        let v = parse(input);
        assert_eq!(v["by_date"]["2024-07-01"]["shown"], 1);
        assert_eq!(v["by_hour"]["08"], 1);
    }

    #[test]
    fn collects_latency_from_json() {
        let input = r#"{"event":"ghost-text/shown","latencyMs":150}"#;
        let v = parse(input);
        assert_eq!(v["latencies"][0], 150);
    }

    #[test]
    fn collects_latency_from_text_fetch_completions() {
        let input = "[fetchCompletions] Request finished after 290ms";
        let v = parse(input);
        assert_eq!(v["latencies"][0], 290);
    }

    #[test]
    fn collects_latency_from_text_ccreq() {
        let input = "2024-06-01 ccreq:abc123 | success | gpt-4o | 800ms | [vscodePrompt]";
        let v = parse(input);
        assert_eq!(v["latencies"][0], 800);
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
        let v = parse(input);
        assert_eq!(v["by_context_source"]["vscodePrompt"], 2);
        assert_eq!(v["by_context_source"]["activeDocument"], 1);
    }

    #[test]
    fn empty_input_has_empty_new_fields() {
        let v = parse("");
        assert!(v["by_date"].as_object().unwrap().is_empty());
        assert!(v["by_hour"].as_object().unwrap().is_empty());
        assert!(v["latencies"].as_array().unwrap().is_empty());
        assert!(v["by_context_source"].as_object().unwrap().is_empty());
    }
}
