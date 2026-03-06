import * as path from "node:path";

/** Pattern for VS Code session directory names (e.g. `20260304T120000`). */
export const SESSION_DIR_PATTERN = /^\d{8}T\d{6}$/;

/**
 * Locate the VS Code session root directory from `fsPath` by splitting on the
 * native path separator and searching for the `logs` landmark segment.
 *
 * VS Code always places session directories directly inside a `logs` folder:
 *   - macOS:   `.../Application Support/Code/logs/<session>/exthost/...`
 *   - Windows: `...\AppData\Roaming\Code\logs\<session>\exthost\...`
 *
 * Splitting on the native separator and finding the `logs` element lets us
 * locate the session root regardless of how many extra directories (e.g.
 * `output_logging_X`) exist between the session root and the extension dir.
 *
 * Returns the session root path (joined with the native separator), or `null`
 * if the expected `logs/<timestamp>` segment is not present in the path.
 */
export function findSessionRoot(fsPath: string): string | null {
  const parts = fsPath.split(path.sep);
  const logsIdx = parts.indexOf("logs");
  if (logsIdx === -1 || logsIdx + 1 >= parts.length) {
    return null;
  }
  const sessionId = parts[logsIdx + 1];
  if (!SESSION_DIR_PATTERN.test(sessionId)) {
    return null;
  }
  // Reconstruct the path up to and including the session directory.
  // Join with the native separator directly (not path.join) so that a leading
  // empty element from splitting a Unix absolute path (e.g. '/Users/...')
  // is preserved as the root separator '/'.
  return parts.slice(0, logsIdx + 2).join(path.sep);
}
