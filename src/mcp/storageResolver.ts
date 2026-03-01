/**
 * Resolves the default VS Code global-storage path for the copilot-insight
 * extension on the current operating system.
 *
 * VS Code stores per-extension data in:
 *
 * | Platform | Path                                                                 |
 * |----------|----------------------------------------------------------------------|
 * | macOS    | `~/Library/Application Support/Code/User/globalStorage/<extId>`      |
 * | Windows  | `%APPDATA%\Code\User\globalStorage\<extId>`                          |
 * | Linux    | `~/.config/Code/User/globalStorage/<extId>`                          |
 *
 * VS Code Insiders variants are tried as a fallback when the stable path does
 * not exist on disk.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Extension publisher + name — must match `package.json`. */
const EXTENSION_ID = "nitta-a.copilot-insight";

/**
 * Return the VS Code `globalStorage` directory for this extension.
 *
 * Priority (first wins):
 * 1. Stable VS Code path for the current OS
 * 2. VS Code Insiders path for the current OS (if stable path does not exist)
 *
 * Parameters are injectable so the function is unit-testable without side
 * effects:
 *
 * @param platform   `os.platform()` return value (default: current platform)
 * @param homeDir    Home directory (default: `os.homedir()`)
 * @param env        `process.env` object (default: current environment)
 */
export function resolveStoragePath(
  platform: NodeJS.Platform = os.platform(),
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const stablePath = buildStoragePath(platform, homeDir, env, false);

  // Fast path: stable directory exists (the common case) — return immediately.
  if (fs.existsSync(stablePath)) {
    return stablePath;
  }

  // Stable path absent: try VS Code Insiders before falling back to stable.
  const insidersPath = buildStoragePath(platform, homeDir, env, true);
  if (fs.existsSync(insidersPath)) {
    return insidersPath;
  }

  return stablePath;
}

/**
 * Build the raw storage path for a given VS Code variant without checking
 * whether it actually exists on disk.
 *
 * @internal
 */
export function buildStoragePath(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  insiders: boolean,
): string {
  const appName = insiders ? "Code - Insiders" : "Code";

  switch (platform) {
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", appName, "User", "globalStorage", EXTENSION_ID);

    case "win32": {
      const appData = env["APPDATA"] ?? path.join(homeDir, "AppData", "Roaming");
      return path.join(appData, appName, "User", "globalStorage", EXTENSION_ID);
    }

    default:
      // Linux and any other POSIX platform
      return path.join(homeDir, ".config", appName, "User", "globalStorage", EXTENSION_ID);
  }
}
