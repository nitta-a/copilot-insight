import * as path from "node:path";

/** Pattern for VS Code session directory names (e.g. `20260304T120000`). */
const SESSION_DIR_PATTERN = /^\d{8}T\d{6}$/;

/**
 * Walk up the directory tree from `startPath` to find the VS Code session root
 * directory — the directory whose name matches the session timestamp pattern
 * (e.g. `20260304T120000`).
 *
 * Returns the session root path, or `null` if not found within `maxLevels`.
 *
 * This handles both path structures that VS Code uses across platforms:
 *   - Without output_logging dir: `.../logs/<session>/exthost/<extension_id>`
 *   - With output_logging dir:    `.../logs/<session>/exthost/output_logging_X/<extension_id>`
 */
export function findSessionRoot(startPath: string, maxLevels = 8): string | null {
  let current = startPath;
  for (let i = 0; i < maxLevels; i++) {
    const name = path.basename(current);
    if (SESSION_DIR_PATTERN.test(name)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break; // reached filesystem root
    }
    current = parent;
  }
  return null;
}
