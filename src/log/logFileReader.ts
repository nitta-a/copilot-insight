import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseLogContent } from "./logContentParser";
import type { ParsingContext } from "../types";

function getMaxSessionDirs(): number {
  return vscode.workspace.getConfiguration("copilot-insight").get<number>("maxSessionDirs", 5);
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

export async function getSortedSessionDirs(logBaseDir: string, fallback: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(logBaseDir);
    const fullPaths = entries.map((entry) => path.join(logBaseDir, entry));
    const dirs: string[] = [];
    for (const dirPath of fullPaths) {
      if (await isDirectory(dirPath)) {
        dirs.push(dirPath);
      }
    }
    return dirs.sort().reverse().slice(0, getMaxSessionDirs());
  } catch {
    return [fallback];
  }
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
