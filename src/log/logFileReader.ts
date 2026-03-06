import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ParsingContext } from "../types";
import { parseLogContent } from "./logContentParser";

function getMaxSessionDirs(): number {
  return vscode.workspace.getConfiguration("copilot-insight").get<number>("maxSessionDirs", 5);
}

interface SessionDirOptions {
  limit?: number;
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
    const entries = await fs.readdir(logBaseDir);
    const fullPaths = entries.map((entry) => path.join(logBaseDir, entry));
    const dirs: string[] = [];
    for (const dirPath of fullPaths) {
      if (await isDirectory(dirPath)) {
        dirs.push(dirPath);
      }
    }
    const sortedDirs = dirs.sort().reverse();
    const limit = options?.limit ?? getMaxSessionDirs();
    return limit > 0 ? sortedDirs.slice(0, limit) : sortedDirs;
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
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (await isDirectory(fullPath)) {
          if (entry.toLowerCase().includes("github.copilot")) {
            results.push(fullPath);
          } else {
            await search(fullPath, depth + 1);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  await search(rootDir, 0);
  return results;
}

export async function parseLogDirectory(logDir: string, ctx: ParsingContext): Promise<void> {
  try {
    const entries = await fs.readdir(logDir);
    const files = entries.filter((f) => f.endsWith(".log"));
    for (const file of files) {
      const filePath = path.join(logDir, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        parseLogContent(content, ctx);
        ctx.logFilesFound++;
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Skip if directory is not readable
  }
}

/**
 * Parse `remoteexthost.log` from each `exthost*` subdirectory within a session
 * directory.
 *
 * In VS Code Remote / WSL environments the extension host runs inside a per-
 * workspace remote process.  VS Code creates one or more numbered `exthost<N>`
 * subdirectories under the session root (e.g. `20260228T180728/exthost1/`) and
 * writes log files inside each of them — NOT at the session root.
 * This function iterates over all `exthost*` siblings and parses every
 * `.log` file it finds directly inside them, silently skipping missing or
 * unreadable files.
 */
export async function parseRemoteExthostLog(sessionDir: string, ctx: ParsingContext): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(sessionDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!/^exthost/i.test(entry)) {
      continue;
    }
    // Parse all .log files directly inside the exthost<N> directory.
    // fs.readdir naturally rejects non-directories, so no explicit isDirectory check is needed.
    const exthostDir = path.join(sessionDir, entry);
    let logFiles: string[];
    try {
      logFiles = await fs.readdir(exthostDir);
    } catch {
      continue;
    }
    for (const logFile of logFiles) {
      if (!logFile.endsWith(".log")) {
        continue;
      }
      const filePath = path.join(exthostDir, logFile);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        parseLogContent(content, ctx);
        ctx.logFilesFound++;
      } catch {
        // Skip unreadable file
      }
    }
  }
}
