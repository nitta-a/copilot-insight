/// Extract the first `{ … }` JSON object slice from a log line.
/// Returns a `&str` slice into the original string — no allocation.
pub(crate) fn extract_json(line: &str) -> Option<&str> {
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
pub(crate) fn ascii_ci_contains(haystack: &str, needle_lower: &str) -> bool {
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
pub(crate) fn extract_latency_from_text(line: &str) -> Option<u32> {
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
pub(crate) fn line_date_key(trimmed: &str) -> Option<&str> {
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
pub(crate) fn line_ts_ms(trimmed: &str) -> Option<u64> {
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
pub(crate) fn line_hour_key(trimmed: &str) -> Option<&str> {
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
pub(crate) fn extract_ccreq_model(trimmed: &str) -> Option<&str> {
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
pub(crate) fn is_subagent_intent_line(trimmed: &str) -> bool {
    ascii_ci_contains(trimmed, "[tool/runsubagent")
        || ascii_ci_contains(trimmed, "[panel/editagent]")
        || ascii_ci_contains(trimmed, "[tool/searchsubagent")
}

/// Extract the finish-reason string from a `[streamChoices]` log line.
///
/// Looks for the pattern `finish reason: [XXX]` (with brackets) or
/// `finish reason: XXX` (without) and returns the trimmed inner token.
pub(crate) fn extract_finish_reason(trimmed: &str) -> Option<String> {
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

/// Normalise a raw model name using the same rules as the TypeScript
/// `normalizeModelName` helper in `parserHelpers.ts`.
///
/// Rules applied in order:
/// 1. Strip everything after ` -> ` (deployment path).
/// 2. Strip colon-suffix (version / date / ID).
/// 3. Strip hash-suffix.
/// 4. Strip trailing `-copilot` vendor suffix.
pub(crate) fn normalize_model(model: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

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
