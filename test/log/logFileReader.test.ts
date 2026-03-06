import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { getAllSessionDirs, getSortedSessionDirs } from "../../src/log/logFileReader";

suite("logFileReader", () => {
  test("getAllSessionDirs returns every session directory in descending order", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-log-reader-"));
    try {
      await fs.mkdir(path.join(tempRoot, "20260228T180728"));
      await fs.mkdir(path.join(tempRoot, "20260301T090000"));
      await fs.mkdir(path.join(tempRoot, "20260302T120000"));

      const sessionDirs = await getAllSessionDirs(tempRoot, path.join(tempRoot, "fallback"));

      assert.deepStrictEqual(sessionDirs, [
        path.join(tempRoot, "20260302T120000"),
        path.join(tempRoot, "20260301T090000"),
        path.join(tempRoot, "20260228T180728"),
      ]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("getSortedSessionDirs falls back when base directory is unreadable", async () => {
    const fallback = path.join(os.tmpdir(), "copilot-insight-fallback");
    const sessionDirs = await getSortedSessionDirs(path.join(os.tmpdir(), "missing-base-dir"), fallback, { limit: 0 });
    assert.deepStrictEqual(sessionDirs, [fallback]);
  });
});
