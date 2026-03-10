import * as path from "node:path";

/** Pattern for VS Code session directory names (e.g. `20260304T120000`). */
const SESSION_DIR_PATTERN = /^\d{8}T\d{6}$/;

export interface ResolvedLogSearchPaths {
  sessionRoot: string | null;
  logBaseDir: string;
  fallbackSessionDir: string;
}

function normalizeFsPath(fsPath: string): string {
  return fsPath.replace(/\\/g, "/");
}

function splitFsPath(fsPath: string): string[] {
  return normalizeFsPath(fsPath).split("/");
}

function joinFsPath(parts: string[]): string {
  return parts.join(path.sep);
}

function findLastSessionSegmentIndex(parts: string[]): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (SESSION_DIR_PATTERN.test(parts[i])) {
      return i;
    }
  }
  return -1;
}

function findLastLogsSegmentIndex(parts: string[]): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "logs") {
      return i;
    }
  }
  return -1;
}

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
  const parts = splitFsPath(fsPath);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] !== "logs") {
      continue;
    }
    const sessionId = parts[i + 1];
    if (!SESSION_DIR_PATTERN.test(sessionId)) {
      continue;
    }
    return joinFsPath(parts.slice(0, i + 2));
  }
  return null;
}

/**
 * Resolve the session root, parent logs directory, and a fallback session path
 * from an arbitrary VS Code log path.
 *
 * This avoids fixed-depth `dirname()` assumptions so Remote-WSL / VS Code
 * Server layouts like `.vscode-server/data/logs/<session>/...` remain valid
 * even when additional intermediate directories are present.
 */
export function resolveLogSearchPaths(fsPath: string): ResolvedLogSearchPaths {
  const sessionRoot = findSessionRoot(fsPath);
  if (sessionRoot) {
    return {
      sessionRoot,
      logBaseDir: path.dirname(sessionRoot),
      fallbackSessionDir: sessionRoot,
    };
  }

  const parts = splitFsPath(fsPath);
  const sessionIdx = findLastSessionSegmentIndex(parts);
  if (sessionIdx !== -1) {
    const fallbackSessionDir = joinFsPath(parts.slice(0, sessionIdx + 1));
    return {
      sessionRoot: null,
      logBaseDir: path.dirname(fallbackSessionDir),
      fallbackSessionDir,
    };
  }

  const logsIdx = findLastLogsSegmentIndex(parts);
  if (logsIdx !== -1) {
    const logBaseDir = joinFsPath(parts.slice(0, logsIdx + 1));
    const fallbackSessionDir = logsIdx + 1 < parts.length ? joinFsPath(parts.slice(0, logsIdx + 2)) : logBaseDir;
    return {
      sessionRoot: null,
      logBaseDir,
      fallbackSessionDir,
    };
  }

  return {
    sessionRoot: null,
    logBaseDir: path.dirname(path.dirname(fsPath)),
    fallbackSessionDir: path.dirname(fsPath),
  };
}
