use std::collections::HashMap;
use std::fmt::Write as FmtWrite;

use napi_derive::napi;

use crate::models::ReportInput;

// ── Report-generation helpers ────────────────────────────────────────────────

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

/// Generate a Markdown report from the provided `ReportInput` data.
///
/// Produces the following sections (all non-optional relative to the data):
/// - Header (title, project, period)
/// - Executive Summary
/// - Legacy Agent Log Activity (when recorded)
/// - Observed Events (when recorded)
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
        format!(
            "{:.1}%",
            input.total_accepted as f64 / input.total_shown as f64 * 100.0
        )
    } else {
        "Unavailable".to_string()
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
    if input.total_shown > 0 {
        let _ = writeln!(buf, "| Suggestions Shown (legacy logs) | {} |", input.total_shown);
    }
    if input.total_shown > 0 || input.total_accepted > 0 {
        let _ = writeln!(buf, "| Suggestions Accepted (legacy logs) | {} |", input.total_accepted);
    }
    let _ = writeln!(buf, "| Acceptance Rate | {} |", acceptance_rate);
    let _ = writeln!(buf, "| Chat Requests | {} |", input.total_chat);
    let _ = writeln!(buf, "| Avg Latency | {} |", avg_latency_display);
    let _ = writeln!(buf, "| Errors | {} |", input.total_errors);
    let _ = writeln!(buf, "| Log Files Parsed | {} |", input.log_files_found);
    let _ = writeln!(buf);

    if input.subagent_requests > 0 || input.autonomous_duration_ms > 0.0 {
        let _ = writeln!(buf, "## Legacy Agent Log Activity");
        let _ = writeln!(buf);
        if input.subagent_requests > 0 {
            let _ = writeln!(buf, "- **Recorded subagent requests**: {}", input.subagent_requests);
        }
        if input.autonomous_duration_ms > 0.0 {
            let _ = writeln!(buf, "- **Recorded elapsed duration**: {}", format_duration_ms(input.autonomous_duration_ms));
        }
        let _ = writeln!(buf);
    }

    // ── Observed events ───────────────────────────────────────────────────────
    let browser_total: u32 = input.browser_tools_by_type.values().sum();
    let plugin_total: u32 = input.plugin_or_skill_by_name.values().sum();
    let has_feature_signals = browser_total > 0
        || plugin_total > 0
        || input.memory_management_count > 0
        || input.agent_debug_events > 0;

    if has_feature_signals {
        let _ = writeln!(buf, "## Observed Events");
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
            browser_tools_by_type: HashMap::new(),
            plugin_or_skill_by_name: HashMap::new(),
            memory_management_count: 0,
            memory_management_by_type: HashMap::new(),
            agent_debug_events: 0,
            agent_debug_by_type: HashMap::new(),
            min_date: "2026-02-01".to_string(),
            max_date: "2026-02-28".to_string(),
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
        assert!(report.contains("| Suggestions Shown (legacy logs) | 100 |"));
        assert!(report.contains("| Suggestions Accepted (legacy logs) | 70 |"));
        assert!(report.contains("| Acceptance Rate | 70.0% |"));
        assert!(report.contains("| Chat Requests | 15 |"));
        assert!(report.contains("| Errors | 2 |"));
        assert!(report.contains("| Log Files Parsed | 5 |"));
    }

    #[test]
    fn report_marks_acceptance_rate_unavailable_without_shown_suggestions() {
        let mut input = make_minimal_report_input();
        input.total_shown = 0;
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("| Acceptance Rate | Unavailable |"));
    }

    #[test]
    fn report_includes_project_name_when_set() {
        let mut input = make_minimal_report_input();
        input.project_name = "my-project".to_string();
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("**Project:** my-project"));
    }





    #[test]
    fn report_omits_productivity_estimates() {
        let report = generate_markdown_report_native(
            make_minimal_report_input(),
            "test".to_string(),
        );
        assert!(!report.contains("Productivity Metrics"));
        assert!(!report.contains("Total Developer Time Saved"));
    }



    #[test]
    fn report_includes_feature_signals_when_browser_tools_present() {
        let mut input = make_minimal_report_input();
        input.browser_tools_by_type =
            [("screenshot".to_string(), 2u32)].into_iter().collect();
        let report = generate_markdown_report_native(input, "test".to_string());
        assert!(report.contains("Observed Events"));
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
