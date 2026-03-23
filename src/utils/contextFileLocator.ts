import * as vscode from "vscode";
import * as path from "node:path";
import type { ProjectContextFile } from "../ui/dashboardMessages";

/**
 * Discover context-definition files from the current VS Code workspace.
 * Matches well-known patterns such as `.github/copilot-instructions.md`,
 * `*.instructions.md`, `*.prompt.md`, `plan.md`, `.cursorrules`, etc.
 */
async function getWorkspaceContextFiles(): Promise<ProjectContextFile[]> {
  const files: ProjectContextFile[] = [];
  const decoder = new TextDecoder();
  try {
    const [specificFiles, instructionFiles] = await Promise.all([
      vscode.workspace.findFiles(
        "**/{plan.md,Plan.md,.cursorrules,copilot-instructions.md,AGENTS.md}",
        "**/node_modules/**",
        50,
      ),
      vscode.workspace.findFiles(
        "**/{.github/copilot-instructions.md,*.instructions.md,*.prompt.md}",
        "**/node_modules/**",
        50,
      ),
    ]);
    // Deduplicate URIs before reading to avoid redundant file I/O
    const seenPaths = new Set<string>();
    const uniqueUris = [...specificFiles, ...instructionFiles].filter((uri) => {
      if (seenPaths.has(uri.fsPath)) {
        return false;
      }
      seenPaths.add(uri.fsPath);
      return true;
    });
    const readResults = await Promise.all(
      uniqueUris.map(async (uri) => {
        try {
          const buf = await vscode.workspace.fs.readFile(uri);
          return {
            path: uri.fsPath,
            name: path.basename(uri.fsPath),
            preview: decoder.decode(buf).slice(0, 100),
            source: "workspace" as const,
          } satisfies ProjectContextFile;
        } catch {
          // skip unreadable files
          return null;
        }
      }),
    );
    for (const f of readResults) {
      if (f !== null) {
        files.push(f);
      }
    }
  } catch {
    // findFiles may fail if no workspace is open
  }
  return files;
}

/**
 * Discover context-definition files from the VS Code user-level prompts directory.
 * Only `.instructions.md` and `.prompt.md` files are included.
 */
async function getUserPromptFiles(userPromptsDir: string | undefined): Promise<ProjectContextFile[]> {
  if (!userPromptsDir) {
    return [];
  }
  const files: ProjectContextFile[] = [];
  const decoder = new TextDecoder();
  try {
    const dirUri = vscode.Uri.file(userPromptsDir);
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    const eligible = entries.filter(
      ([name, type]) =>
        type === vscode.FileType.File && (name.endsWith(".instructions.md") || name.endsWith(".prompt.md")),
    );
    const readResults = await Promise.all(
      eligible.map(async ([name]) => {
        const fileUri = vscode.Uri.joinPath(dirUri, name);
        try {
          const buf = await vscode.workspace.fs.readFile(fileUri);
          return {
            path: fileUri.fsPath,
            name,
            preview: decoder.decode(buf).slice(0, 100),
            source: "user-prompts" as const,
          } satisfies ProjectContextFile;
        } catch {
          // skip unreadable files
          return null;
        }
      }),
    );
    for (const f of readResults) {
      if (f !== null) {
        files.push(f);
      }
    }
  } catch {
    // prompts dir may not exist
  }
  return files;
}

/**
 * Discover context-definition files from Copilot Plan Agent session memory directories.
 * Only `.md` files inside session subdirectories are included; the `repo/` subdirectory
 * is skipped as it contains agent notes rather than user-facing files.
 */
async function getCopilotMemoryFiles(copilotMemoryDir: string | undefined): Promise<ProjectContextFile[]> {
  if (!copilotMemoryDir) {
    return [];
  }
  const files: ProjectContextFile[] = [];
  const decoder = new TextDecoder();
  try {
    const memoriesUri = vscode.Uri.file(copilotMemoryDir);
    const sessionDirs = await vscode.workspace.fs.readDirectory(memoriesUri);
    const sessionDirEntries = sessionDirs.filter(
      ([sessionDirName, sessionDirType]) => sessionDirType === vscode.FileType.Directory && sessionDirName !== "repo",
    );
    const sessionResults = await Promise.all(
      sessionDirEntries.map(async ([sessionDirName]) => {
        const sessionDirUri = vscode.Uri.joinPath(memoriesUri, sessionDirName);
        const sessionFiles: ProjectContextFile[] = [];
        try {
          const entries = await vscode.workspace.fs.readDirectory(sessionDirUri);
          const mdFiles = entries.filter(
            ([fileName, fileType]) => fileType === vscode.FileType.File && fileName.endsWith(".md"),
          );
          const readResults = await Promise.all(
            mdFiles.map(async ([fileName]) => {
              const fileUri = vscode.Uri.joinPath(sessionDirUri, fileName);
              try {
                const buf = await vscode.workspace.fs.readFile(fileUri);
                return {
                  path: fileUri.fsPath,
                  name: fileName,
                  preview: decoder.decode(buf).slice(0, 100),
                  source: "copilot-memory" as const,
                } satisfies ProjectContextFile;
              } catch {
                // skip unreadable files
                return null;
              }
            }),
          );
          for (const f of readResults) {
            if (f !== null) {
              sessionFiles.push(f);
            }
          }
        } catch {
          // skip unreadable session directories
        }
        return sessionFiles;
      }),
    );
    for (const sessionFiles of sessionResults) {
      files.push(...sessionFiles);
    }
  } catch {
    // copilotMemoryDir may not exist
  }
  return files;
}

/**
 * Collect all project context files from three sources in parallel:
 * 1. Workspace files matching known patterns (e.g. `.github/copilot-instructions.md`)
 * 2. VS Code user-level prompts directory
 * 3. Copilot Plan Agent session memory files (workspaceStorage)
 *
 * Duplicate paths (same `fsPath`) are removed from the final result.
 */
export async function collectAllContextFiles(
  userPromptsDir?: string,
  copilotMemoryDir?: string,
): Promise<ProjectContextFile[]> {
  const [workspaceFiles, userPromptFiles, memoryFiles] = await Promise.all([
    getWorkspaceContextFiles(),
    getUserPromptFiles(userPromptsDir),
    getCopilotMemoryFiles(copilotMemoryDir),
  ]);

  // Deduplicate by path in case the same file appears in multiple sources
  const seenPaths = new Set<string>();
  const result: ProjectContextFile[] = [];
  for (const f of [...workspaceFiles, ...userPromptFiles, ...memoryFiles]) {
    if (!seenPaths.has(f.path)) {
      seenPaths.add(f.path);
      result.push(f);
    }
  }
  return result;
}
