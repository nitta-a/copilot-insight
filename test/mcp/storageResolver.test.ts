import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildStoragePath, resolveStoragePath } from "../../src/mcp/storageResolver";

const EXTENSION_ID = "nitta-a.copilot-insight";
const HOME = "/home/testuser";
const EMPTY_ENV: NodeJS.ProcessEnv = {};

suite("storageResolver – buildStoragePath", () => {
  test("linux returns ~/.config/Code path", () => {
    const result = buildStoragePath("linux", HOME, EMPTY_ENV, false);
    assert.strictEqual(result, path.join(HOME, ".config", "Code", "User", "globalStorage", EXTENSION_ID));
  });

  test("linux insiders returns ~/.config/Code - Insiders path", () => {
    const result = buildStoragePath("linux", HOME, EMPTY_ENV, true);
    assert.strictEqual(result, path.join(HOME, ".config", "Code - Insiders", "User", "globalStorage", EXTENSION_ID));
  });

  test("darwin returns ~/Library/Application Support/Code path", () => {
    const result = buildStoragePath("darwin", HOME, EMPTY_ENV, false);
    assert.strictEqual(
      result,
      path.join(HOME, "Library", "Application Support", "Code", "User", "globalStorage", EXTENSION_ID),
    );
  });

  test("darwin insiders returns ~/Library/Application Support/Code - Insiders path", () => {
    const result = buildStoragePath("darwin", HOME, EMPTY_ENV, true);
    assert.strictEqual(
      result,
      path.join(HOME, "Library", "Application Support", "Code - Insiders", "User", "globalStorage", EXTENSION_ID),
    );
  });

  test("win32 uses APPDATA env var when set", () => {
    const env: NodeJS.ProcessEnv = {};
    env["APPDATA"] = "C:\\Users\\testuser\\AppData\\Roaming";
    const result = buildStoragePath("win32", HOME, env, false);
    assert.strictEqual(
      result,
      path.join("C:\\Users\\testuser\\AppData\\Roaming", "Code", "User", "globalStorage", EXTENSION_ID),
    );
  });

  test("win32 falls back to AppData/Roaming under homeDir when APPDATA not set", () => {
    const result = buildStoragePath("win32", HOME, EMPTY_ENV, false);
    assert.strictEqual(result, path.join(HOME, "AppData", "Roaming", "Code", "User", "globalStorage", EXTENSION_ID));
  });

  test("win32 insiders uses Code - Insiders", () => {
    const env: NodeJS.ProcessEnv = {};
    env["APPDATA"] = "C:\\Users\\testuser\\AppData\\Roaming";
    const result = buildStoragePath("win32", HOME, env, true);
    assert.ok(result.includes("Code - Insiders"), `Expected 'Code - Insiders' in '${result}'`);
  });

  test("unknown platform defaults to linux-style path", () => {
    const result = buildStoragePath("freebsd", HOME, EMPTY_ENV, false);
    assert.strictEqual(result, path.join(HOME, ".config", "Code", "User", "globalStorage", EXTENSION_ID));
  });

  test("EXTENSION_ID is embedded in all paths", () => {
    const env: NodeJS.ProcessEnv = {};
    env["APPDATA"] = "C:\\AppData";
    for (const platform of ["linux", "darwin", "win32"] as NodeJS.Platform[]) {
      const result = buildStoragePath(platform, HOME, env, false);
      assert.ok(result.endsWith(EXTENSION_ID), `Expected path to end with '${EXTENSION_ID}', got '${result}'`);
    }
  });
});

suite("storageResolver – resolveStoragePath", () => {
  test("returns a non-empty string on the current platform", () => {
    const result = resolveStoragePath();
    assert.ok(typeof result === "string" && result.length > 0);
  });

  test("returns path containing the extension ID on the current platform", () => {
    const result = resolveStoragePath();
    assert.ok(result.includes(EXTENSION_ID), `Expected '${EXTENSION_ID}' in '${result}'`);
  });

  test("returns stable path when neither stable nor insiders exist", () => {
    // Use a non-existent home directory so neither path can exist.
    const fakeHome = path.join(os.tmpdir(), "no-such-home-99999");
    const result = resolveStoragePath("linux", fakeHome, EMPTY_ENV);
    const expected = path.join(fakeHome, ".config", "Code", "User", "globalStorage", EXTENSION_ID);
    assert.strictEqual(result, expected);
  });

  test("returns insiders path when only insiders directory exists", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-insight-insiders-test-"));
    try {
      // Create the insiders globalStorage directory but NOT the stable one.
      const insidersDir = path.join(tmpHome, ".config", "Code - Insiders", "User", "globalStorage", EXTENSION_ID);
      fs.mkdirSync(insidersDir, { recursive: true });

      const result = resolveStoragePath("linux", tmpHome, EMPTY_ENV);
      assert.strictEqual(result, insidersDir);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("prefers stable path over insiders when both exist", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-insight-both-test-"));
    try {
      const stableDir = path.join(tmpHome, ".config", "Code", "User", "globalStorage", EXTENSION_ID);
      const insidersDir = path.join(tmpHome, ".config", "Code - Insiders", "User", "globalStorage", EXTENSION_ID);
      fs.mkdirSync(stableDir, { recursive: true });
      fs.mkdirSync(insidersDir, { recursive: true });

      const result = resolveStoragePath("linux", tmpHome, EMPTY_ENV);
      assert.strictEqual(result, stableDir);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("custom homeDir is reflected in the resolved path", () => {
    const customHome = path.join(os.tmpdir(), "custom-home-test");
    const result = resolveStoragePath("linux", customHome, EMPTY_ENV);
    assert.ok(result.startsWith(customHome), `Expected path to start with '${customHome}', got '${result}'`);
  });
});
