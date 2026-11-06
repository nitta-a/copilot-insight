const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async () => {
  const root = process.env.COPILOT_SMOKE_DIR;
  const extension = vscode.extensions.getExtension("nitta-a.copilot-insight");
  assert.ok(extension, "VSIX extension was not installed");
  assert.ok(extension.extensionPath.startsWith(path.join(root, "extensions") + path.sep));
  await assert.rejects(fs.access(path.join(extension.extensionPath, "native-parser", "target")), { code: "ENOENT" });
  const logs = path.join(root, "user-data", "logs");
  const session = (await fs.readdir(logs))
    .filter((name) => /^\d{8}T\d{6}$/.test(name))
    .sort()
    .at(-1);
  assert.ok(session, "VS Code log session was not created");
  const copilotLogs = path.join(logs, session, "exthost-smoke", "github.copilot");
  await fs.mkdir(copilotLogs, { recursive: true });
  await fs.writeFile(
    path.join(copilotLogs, "copilot.log"),
    '{"event":"suggestion_shown","timestamp":"2026-11-01T10:00:00Z"}\n',
  );
  await vscode.workspace.getConfiguration("copilot-insight").update("cliLogPath", path.join(root, "cli"), true);
  await extension.activate();
  await vscode.commands.executeCommand("copilot-insight.showCopilotUsage");
  const nativePath = await fs.realpath(path.join(extension.extensionPath, "native-parser"));
  assert.ok(
    Object.keys(require.cache).some((name) => name.startsWith(nativePath + path.sep) && name.endsWith(".node")),
    "installed extension did not load its native parser",
  );
  await fs.writeFile(path.join(root, "ready"), "ready");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fs.access(path.join(root, "done"));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Browser smoke test did not finish");
};
