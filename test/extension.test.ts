import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Extension integration", () => {
  test("activates and opens the usage panel from its command", async function () {
    this.timeout(30_000);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-extension-"));
    const config = vscode.workspace.getConfiguration("copilot-insight");
    const originalPath = config.inspect<string>("cliLogPath")?.globalValue;
    const originalAnalysis = config.inspect<boolean>("enableAdvancedAnalysis")?.globalValue;
    const panels = () =>
      vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs.filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.label === "GitHub Copilot Usage"),
      );
    try {
      await config.update("cliLogPath", dir, vscode.ConfigurationTarget.Global);
      await config.update("enableAdvancedAnalysis", true, vscode.ConfigurationTarget.Global);
      const extension = vscode.extensions.getExtension("nitta-a.copilot-insight");
      assert.ok(extension, "extension is installed in the test host");
      await extension.activate();
      assert.ok(extension.isActive);
      assert.ok((await vscode.commands.getCommands(true)).includes("copilot-insight.showCopilotUsage"));

      const opened = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          listener.dispose();
          reject(new Error("Usage panel did not open"));
        }, 10_000);
        const listener = vscode.window.tabGroups.onDidChangeTabs(() => {
          if (panels().length > 0) {
            clearTimeout(timer);
            listener.dispose();
            resolve();
          }
        });
      });
      await vscode.commands.executeCommand("copilot-insight.showCopilotUsage");
      await opened;
      assert.strictEqual(panels().length, 1);
      assert.strictEqual(panels()[0].label, "GitHub Copilot Usage");
      await vscode.commands.executeCommand("copilot-insight.showCopilotUsage");
      assert.strictEqual(panels().length, 1, "opening again reuses the existing panel");
    } finally {
      await vscode.window.tabGroups.close(panels());
      await config.update("cliLogPath", originalPath, vscode.ConfigurationTarget.Global);
      await config.update("enableAdvancedAnalysis", originalAnalysis, vscode.ConfigurationTarget.Global);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
