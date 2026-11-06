const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright-core");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const executable = process.env.VSCODE_EXECUTABLE_PATH;
  assert.ok(executable, "Set VSCODE_EXECUTABLE_PATH to the VS Code executable");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-vsix-"));
  const vsix = path.join(dir, "extension.vsix");
  const userData = path.join(dir, "user-data");
  const extensions = path.join(dir, "extensions");
  const driver = path.join(dir, "driver");
  const cliSession = path.join(dir, "cli", "smoke-session");
  let browser;
  let run;
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "node_modules/@vscode/vsce/vsce"), "package", "--no-dependencies", "--out", vsix],
      { cwd: root, stdio: "inherit" },
    );
    await fs.mkdir(cliSession, { recursive: true });
    await fs.mkdir(driver);
    await fs.writeFile(
      path.join(driver, "package.json"),
      JSON.stringify({ name: "smoke-driver", publisher: "test", version: "1.0.0", engines: { vscode: "^1.105.0" } }),
    );
    await fs.writeFile(
      path.join(cliSession, "events.jsonl"),
      [
        { type: "session.start", data: { sessionId: "smoke-session", startTime: "2026-11-01T10:00:00Z" } },
        { type: "user.message", timestamp: "2026-11-01T10:00:00Z", data: { content: "Smoke test conversation" } },
        {
          type: "session.usage_record",
          timestamp: "2026-11-01T10:01:00Z",
          data: {
            usage: {
              model: "smoke-model",
              inputTokens: 100,
              outputTokens: 20,
              copilotUsage: { totalNanoAiu: 1_000_000_000 },
            },
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );
    const cli =
      process.platform === "darwin"
        ? path.resolve(path.dirname(executable), "../Resources/app/bin/code")
        : path.join(path.dirname(executable), "bin", "code");
    execFileSync(
      cli,
      ["--user-data-dir", userData, "--extensions-dir", extensions, "--install-extension", vsix, "--force"],
      { stdio: "inherit" },
    );
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => resolve(address.port));
      });
    });
    run = runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: driver,
      extensionTestsPath: path.join(root, "test/smoke/installedRunner.cjs"),
      extensionTestsEnv: { COPILOT_SMOKE_DIR: dir },
      launchArgs: [
        `--user-data-dir=${userData}`,
        `--extensions-dir=${extensions}`,
        `--remote-debugging-port=${port}`,
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
      ],
    });
    // Attach a rejection handler immediately; the failure is rethrown after cleanup.
    run.catch(() => {});
    const deadline = Date.now() + 60_000;
    while (!browser && Date.now() < deadline) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.ok(browser, "VS Code debugging endpoint did not start");
    let frame;
    while (!frame && Date.now() < deadline) {
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          for (const candidate of page.frames()) {
            if (
              await candidate
                .locator("#db-summary-cards")
                .count()
                .catch(() => 0)
            )
              frame = candidate;
          }
        }
      }
      if (!frame) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(frame, "Dashboard webview did not load");
    await frame.locator('copilot-stat-card[label="Copilot CLI AI Credits"]').waitFor({ timeout: 15_000 });
    const card = frame.locator('copilot-stat-card[label="Copilot CLI AI Credits"]');
    assert.equal(await card.evaluate((element) => element.value), "1");
    const shown = frame.locator('copilot-stat-card[label="Suggestions Shown"]');
    assert.equal(await shown.evaluate((element) => element.value), "1");
    await frame.locator('[data-tab="sessions"]').click();
    await frame.locator("#db-sessions-content").waitFor({ state: "visible", timeout: 15_000 });
    const thread = frame.locator("copilot-thread-list").getByRole("button", { name: /Smoke test conversation/ });
    await thread.click({ timeout: 15_000 });
    await frame
      .locator("copilot-thread-detail")
      .getByText("Smoke test conversation")
      .first()
      .waitFor({ timeout: 15_000 });
    await frame.locator('[data-tab="prompt-insights"]').click();
    await frame.locator("#db-prompt-insights-content").waitFor({ state: "visible", timeout: 15_000 });
    await fs.writeFile(path.join(dir, "done"), "done");
    await run;
    console.log("VSIX installation and dashboard smoke test passed");
  } finally {
    if (run) await fs.writeFile(path.join(dir, "done"), "done").catch(() => {});
    if (browser) await browser.close();
    if (run) await run.catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
