/**
 * Regex to identify VS Code session root directories within a log path.
 *
 * Matches the `.../logs/<session>` prefix of any VS Code log path, where
 * `<session>` is a timestamp directory such as `20260304T120000`.
 * Handles both forward-slash (Unix/Mac) and backslash (Windows) separators.
 *
 * Using a direct string match rather than walking up the directory tree makes
 * this robust to any number of intermediate directories between the session
 * root and the extension's log folder (e.g. the `output_logging_X` level that
 * macOS VS Code inserts between `exthost/` and the extension directory).
 */
const LOGS_SESSION_PATTERN = /^(.*[/\\]logs[/\\]\d{8}T\d{6})(?:[/\\]|$)/;

/**
 * Extract the VS Code session root directory from a log file system path by
 * scanning the path string for the `.../logs/<session>` segment.
 *
 * Returns the session root path (preserving the original path separators), or
 * `null` if the expected `/logs/<timestamp>` pattern is not found.
 */
export function findSessionRoot(fsPath: string): string | null {
  const match = fsPath.match(LOGS_SESSION_PATTERN);
  return match ? match[1] : null;
}
