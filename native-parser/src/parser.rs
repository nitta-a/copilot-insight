use std::collections::HashMap;

use crate::line_utils::{
    ascii_ci_contains, extract_ccreq_model, extract_finish_reason, extract_json,
    extract_latency_from_text, is_subagent_intent_line, line_date_key, line_hour_key, line_ts_ms,
    normalize_model,
};
use crate::log_entry::LogEntry;
use crate::models::{NativeContextRichness, NativeStats};

/// Core parsing logic: process each line and accumulate into `NativeStats`.
pub(crate) fn parse_lines<I, S>(lines: I) -> NativeStats
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NativeStats;

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

    // ── New fields: by_chat_model, subagent_by_model, autonomous_duration_by_model ──

    #[test]
    fn plain_text_chat_ccreq_populates_by_chat_model_and_chat_by_date() {
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
}
