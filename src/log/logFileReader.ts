import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import type { ParsingContext } from "../types";
import { parseLogFile } from "./logContentParser";
import { getLogChannel, isTimingLogsEnabled } from "./logChannel";

function getMaxSessionDirs(): number {
  return vscode.workspace.getConfiguration("copilot-insight").get<number>("maxSessionDirs", 10);
}

/** Files that take longer than this threshold (ms) are logged as slow. */
const SLOW_FILE_THRESHOLD_MS = 100;

interface SessionDirOptions {
  limit?: number;
}

async function findExthostDirs(rootDir: string, maxDepth = 3): Promise<string[]> {
  const results: string[] = [];

  async function search(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (/^exthost\d*$/i.test(entry.name)) {
        results.push(path.join(dir, entry.name));
        continue;
      }
      await search(path.join(dir, entry.name), depth + 1);
    }
  }

  await search(rootDir, 0);
  return results;
}

export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(dirPath);
    if (stat.isSymbolicLink()) {
      return false;
    }
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function getSortedSessionDirs(
  logBaseDir: string,
  fallback: string,
  options?: SessionDirOptions,
): Promise<string[]> {
  try {
    const entries = await fs.readdir(logBaseDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(logBaseDir, e.name))
      .sort()
      .reverse();
    const limit = options?.limit ?? getMaxSessionDirs();
    return limit > 0 ? dirs.slice(0, limit) : dirs;
  } catch {
    return [fallback];
  }
}

export async function getAllSessionDirs(logBaseDir: string, fallback: string): Promise<string[]> {
  return getSortedSessionDirs(logBaseDir, fallback, { limit: 0 });
}

/**
 * Recursively search for Copilot log directories under `rootDir`.
 * Any directory whose name matches `github.copilot` (case-insensitive) is
 * collected without recursing further into it.
 * Non-matching directories are recursed into up to `maxDepth` levels deep.
 */
export async function findCopilotDirs(rootDir: string, maxDepth = 5): Promise<string[]> {
  const results: string[] = [];
  async function search(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.toLowerCase().includes("github.copilot")) {
        results.push(path.join(dir, entry.name));
      } else {
        await search(path.join(dir, entry.name), depth + 1);
      }
    }
  }
  await search(rootDir, 0);
  return results;
}

export async function parseLogDirectory(logDir: string, ctx: ParsingContext): Promise<void> {
  const timingEnabled = isTimingLogsEnabled();
  const dirStartMs = timingEnabled ? performance.now() : 0;
  try {
    const entries = await fs.readdir(logDir, { withFileTypes: true });
    const logFiles = entries.filter((e) => !e.isDirectory() && e.name.endsWith(".log"));
    const results = await Promise.all(
      logFiles.map(async (e) => {
        const filePath = path.join(logDir, e.name);
        const result = await parseLogFile(filePath, ctx);
        if (timingEnabled && result.elapsedMs >= SLOW_FILE_THRESHOLD_MS) {
          getLogChannel().appendLine(
            `[TIMING] slow file (${result.elapsedMs.toFixed(1)}ms): ${filePath} [${result.usedNative ? "native" : "js"}]`,
          );
        }
        return result;
      }),
    );
    const parsed = results.filter((r) => r.success).length;
    ctx.logFilesFound += parsed;
    if (timingEnabled) {
      getLogChannel().appendLine(
        `[TIMING] parseLogDirectory: ${(performance.now() - dirStartMs).toFixed(1)}ms | ${parsed}/${logFiles.length} file(s): ${logDir}`,
      );
    }
  } catch {
    // Skip if directory is not readable
  }
}

/**
 * Parse `.log` files from each `exthost*` directory discovered within a
 * session directory.
 *
 * In VS Code Remote / WSL environments the extension host runs inside a per-
 * workspace remote process. VS Code may place those directories directly under
 * the session root (e.g. `20260228T180728/exthost1/`) or under window-specific
 * directories (e.g. `20260228T180728/window1/exthost/`). This function finds
 * both layouts and parses every `.log` file it finds directly inside them,
 * silently skipping missing or unreadable files.
 */
export async function parseRemoteExthostLog(
  sessionDir: string,
  ctx: ParsingContext,
): Promise<{ matchedDirs: number; parsedFiles: number }> {
  const timingEnabled = isTimingLogsEnabled();
  const exthostDirs = await findExthostDirs(sessionDir);
  const countsByDir = await Promise.all(
    exthostDirs.map(async (exthostDir) => {
      const dirStartMs = timingEnabled ? performance.now() : 0;
      const entries = await fs.readdir(exthostDir, { withFileTypes: true }).catch(() => null);
      if (!entries) {
        return 0;
      }
      const logFiles = entries.filter((e) => !e.isDirectory() && e.name.endsWith(".log"));
      const results = await Promise.all(
        logFiles.map(async (e) => {
          const filePath = path.join(exthostDir, e.name);
          const result = await parseLogFile(filePath, ctx);
          if (timingEnabled && result.elapsedMs >= SLOW_FILE_THRESHOLD_MS) {
            getLogChannel().appendLine(
              `[TIMING] slow file (${result.elapsedMs.toFixed(1)}ms): ${filePath} [${result.usedNative ? "native" : "js"}]`,
            );
          }
          return result;
        }),
      );
      const parsed = results.filter((r) => r.success).length;
      if (timingEnabled) {
        getLogChannel().appendLine(
          `[TIMING] exthost dir: ${(performance.now() - dirStartMs).toFixed(1)}ms | ${parsed}/${logFiles.length} file(s): ${exthostDir}`,
        );
      }
      return parsed;
    }),
  );
  const parsedFiles = countsByDir.reduce((sum, n) => sum + n, 0);
  ctx.logFilesFound += parsedFiles;
  return { matchedDirs: exthostDirs.length, parsedFiles };
}

export async function parseSessionTerminalLog(sessionDir: string, ctx: ParsingContext): Promise<boolean> {
  const terminalLogPath = path.join(sessionDir, "terminal.log");
  const result = await parseLogFile(terminalLogPath, ctx);
  if (result.success) {
    ctx.logFilesFound++;
  }
  if (isTimingLogsEnabled()) {
    getLogChannel().appendLine(
      `[TIMING] terminal.log: ${result.elapsedMs.toFixed(1)}ms [${result.usedNative ? "native" : "js"}] | ${result.success ? "parsed" : "missing/unreadable"}: ${terminalLogPath}`,
    );
  }
  return result.success;
}
