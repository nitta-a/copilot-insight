#![deny(clippy::all)]

mod log_entry;
mod line_utils;
mod models;
mod parser;
mod report;

pub use models::{NativeContextRichness, NativeDateStat, NativeStats, ReportInput};

use napi_derive::napi;
use std::fs::File;
use std::io::{BufRead, BufReader};

/// Parse a log chunk provided as a string and return aggregated statistics.
///
/// This function processes each non-empty line of `input`, classifying it as
/// either a JSON-embedded log entry or a plain-text inline-completion line.
/// The resulting `NativeStats` object is returned directly to JavaScript
/// without any intermediate JSON serialization.
#[napi]
pub fn parse_log_chunk(input: String) -> NativeStats {
    parser::parse_lines(input.lines().map(|l| l.to_string()))
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
    Ok(parser::parse_lines(lines))
}
