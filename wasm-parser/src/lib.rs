use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Result of parsing a log chunk.
#[derive(Serialize)]
pub struct ParseResult {
    /// Total number of non-empty lines in the input.
    pub total_lines: usize,
    /// Number of lines that were successfully parsed as JSON.
    pub json_lines: usize,
}

/// Parse a log chunk and return a JSON-serialised `ParseResult`.
///
/// This is a PoC implementation that splits the input text into lines,
/// attempts to parse each non-empty line as JSON, and counts the number
/// of lines that succeeded.
#[wasm_bindgen]
pub fn parse_log_chunk(input: &str) -> String {
    let mut total_lines: usize = 0;
    let mut json_lines: usize = 0;

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        total_lines += 1;

        // Try to find a JSON object embedded in the line.
        if let Some(start) = trimmed.find('{') {
            if let Some(end) = trimmed.rfind('}') {
                if start < end {
                    let candidate = &trimmed[start..=end];
                    if serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
                        json_lines += 1;
                    }
                }
            }
        }
    }

    let result = ParseResult {
        total_lines,
        json_lines,
    };

    serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"total_lines":0,"json_lines":0}"#.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_returns_zeros() {
        let result = parse_log_chunk("");
        assert_eq!(result, r#"{"total_lines":0,"json_lines":0}"#);
    }

    #[test]
    fn counts_json_lines() {
        let input = r#"plain text line
{"event":"suggestion_shown"}
another text
{"event":"suggestion_accepted","language":"typescript"}
"#;
        let result: serde_json::Value = serde_json::from_str(&parse_log_chunk(input)).unwrap();
        assert_eq!(result["total_lines"], 4);
        assert_eq!(result["json_lines"], 2);
    }

    #[test]
    fn handles_embedded_json() {
        let input = r#"2024-06-01 [info] {"event":"suggestion_shown"}"#;
        let result: serde_json::Value = serde_json::from_str(&parse_log_chunk(input)).unwrap();
        assert_eq!(result["total_lines"], 1);
        assert_eq!(result["json_lines"], 1);
    }

    #[test]
    fn skips_blank_lines() {
        let input = "\n\n  \n";
        let result: serde_json::Value = serde_json::from_str(&parse_log_chunk(input)).unwrap();
        assert_eq!(result["total_lines"], 0);
        assert_eq!(result["json_lines"], 0);
    }
}
