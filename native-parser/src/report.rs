use std::collections::HashMap;
use std::fmt::Write as FmtWrite;

use napi_derive::napi;

use crate::line_utils::normalize_model;
use crate::models::ReportInput;

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

#[cfg(test)]
mod tests {
    use super::{format_duration_ms, generate_markdown_report_native};
    use crate::models::ReportInput;
    use std::collections::HashMap;

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
