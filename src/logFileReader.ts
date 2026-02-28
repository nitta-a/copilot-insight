import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseLogContent } from "./logContentParser";
import type { ParsingContext } from "./types";

/** Maximum number of recent session directories to scan. */
const MAX_SESSION_DIRS = 5;

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
    return dirs.sort().reverse().slice(0, MAX_SESSION_DIRS);
  } catch {
    return [fallback];
  }
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
