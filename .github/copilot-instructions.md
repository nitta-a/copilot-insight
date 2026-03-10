# Copilot Instructions

## Overview

VS Code extension that parses GitHub Copilot's local log files and displays usage statistics (suggestions shown/accepted, acceptance rate by language and date) in a WebviewPanel.

## Directory Structure

```
copilot-insight/
├── .github/
│   ├── copilot-instructions.md   # This file — agent guidance and conventions
│   └── workflows/
│       ├── ci.yml                # CI: type-check, lint, test on push/PR
│       └── release.yml           # Publish to VS Code Marketplace on tag push
├── images/                       # Extension icon and screenshot assets
├── src/
│   ├── extension.ts              # Activation entry point; registers all commands and wires the pipeline
│   ├── types.ts                  # Shared TypeScript interfaces (CopilotUsageStats, ParsingContext, …)
│   ├── utils.ts                  # Shared helpers (e.g. todayDateString)
│   ├── globals.d.ts              # Ambient declarations for webview global (acquireVsCodeApi)
│   ├── log/
│   │   ├── copilotLogParser.ts   # Orchestrates log discovery and delegates to logFileReader / logContentParser
│   │   ├── logFileReader.ts      # File-system utilities: session dir sorting, .log file reading
│   │   └── logContentParser.ts  # Line-by-line parser for both JSON-embedded and plain-text log formats
│   ├── ui/
│   │   ├── copilotUsagePanel.ts  # Singleton WebviewPanel (createOrShow pattern)
│   │   ├── copilotUsageHtml.ts   # Generates the HTML shell that loads the webview bundle
│   │   ├── copilotUsageTreeProvider.ts  # TreeDataProvider powering the "Copilot Usage" sidebar view
│   │   ├── dashboardMessages.ts  # Shared WebView ↔ Extension Host message types (HostToWebviewMessage, WebviewToHostMessage)
│   │   ├── dashboardPayload.ts   # Standalone buildDashboardPayload() function (no VS Code deps; unit-testable)
│   │   └── statusBarIndicator.ts
│   ├── events/
│   │   ├── eventSchema.ts
│   │   ├── eventStorage.ts
│   │   ├── eventTracker.ts
│   │   └── inlineCompletionWrapper.ts   # Real-time inline-completion tracking via provider interception
│   ├── metrics/
│   │   ├── metricsEngine.ts
│   │   ├── metricsWorker.ts
│   │   ├── metricsWorkerClient.ts
│   │   └── weeklyTrend.ts        # Compares this-week vs last-week acceptance rates
│   ├── export/
│   │   ├── exportStats.ts        # Serializes CopilotUsageStats to CSV or JSON
│   │   └── reportGenerator.ts   # Professional Markdown report (ROI, language breakdown, model performance, velocity)
│   ├── mcp/
│   │   ├── server.ts             # MCP server exposing get_usage_summary / get_model_efficiency / get_anomaly_report tools
│   │   └── storageResolver.ts   # Resolves the global storage path for the MCP server
│   ├── utils/
│   │   └── logPaths.ts          # findSessionRoot() — segment-based VS Code log directory locator
│   ├── db/
│   │   ├── dbSchema.ts
│   │   └── duckdbClient.ts       # Placeholder DuckDB client interface (not yet wired)
│   └── worker/
│       ├── dbWorker.ts
│       └── dbWorkerClient.ts
├── webview/                      # WebView frontend (compiled to dist/webview/ by tsconfig.webview.json)
│   ├── dashboard.ts              # Chart.js dashboard: Timeline chart, Velocity scatter plot, export handling
│   └── charts/
│       ├── AgenticEfficiencyScatterPlot.tsx  # React scatter plot (Avg Calls/Loop vs Completion Rate)
│       └── ModelDepthVelocityChart.tsx       # React ComposedChart (agentic depth bars + velocity line)
├── test/                         # Mocha/vscode-test test files (*.test.ts)
│   ├── extension.test.ts
│   ├── utils.test.ts
│   ├── log/
│   │   ├── logContentParser.test.ts
│   │   └── logPaths.test.ts
│   ├── ui/
│   │   ├── copilotUsageTreeProvider.test.ts
│   │   ├── dashboardPayload.test.ts
│   │   └── statusBarIndicator.test.ts
│   ├── mcp/
│   │   ├── server.test.ts
│   │   └── storageResolver.test.ts
│   ├── events/
│   │   ├── eventSchema.test.ts
│   │   ├── eventStorage.test.ts
│   │   ├── eventTracker.test.ts
│   │   └── inlineCompletionWrapper.test.ts
│   ├── metrics/
│   │   ├── metricsEngine.test.ts
│   │   └── weeklyTrend.test.ts
│   ├── export/
│   │   ├── exportStats.test.ts
│   │   └── reportGenerator.test.ts
│   ├── db/
│   │   ├── dbSchema.test.ts
│   │   └── duckdbClient.test.ts
│   └── worker/
│       └── dbWorkerClient.test.ts
├── dist/                         # Build output — extension.js + webview/ (CJS bundle, git-ignored)
├── bin/
│   └── mcp-server.js             # MCP server entry point (registered via contributes.mcpServers)
├── biome.json                    # Biome linter + formatter config
├── esbuild.js                    # esbuild bundler script (dev and production modes)
├── package.json                  # Extension manifest, commands, configuration, scripts
├── tsconfig.json                 # TypeScript compiler options (target: ES2022, module: Node16)
└── tsconfig.webview.json         # TypeScript compiler options for the webview bundle
```

## Architecture

Four-layer pipeline:

1. **`src/log/copilotLogParser.ts`** — reads `.log` files from VS Code's extension host log directory, parses both JSON-embedded lines (matching `/\{.*\}/`) and plain-text lines, and accumulates `CopilotUsageStats`.
2. **`src/ui/dashboardPayload.ts`** — `buildDashboardPayload()` converts raw `CopilotUsageStats` + optional advanced-metrics into the typed `DashboardPayload` shape consumed by the WebView; no VS Code dependencies, fully unit-testable.
3. **`src/ui/copilotUsagePanel.ts`** — singleton `WebviewPanel` via `createOrShow` pattern; holds `static currentPanel` reference; `enableScripts: true`; serves the bundled webview from `dist/webview/` via `localResourceRoots`.
4. **`webview/dashboard.ts`** — Chart.js frontend (bundled separately by `tsconfig.webview.json`); renders the Timeline, Velocity, and export charts; communicates with the host via `vscode.postMessage` using the typed protocol in `dashboardMessages.ts`.

`extension.ts` wires commands to the pipeline using `vscode.window.withProgress` for the parsing step.

## Key Modules

- **`src/utils/logPaths.ts`** — `findSessionRoot(fsPath)` locates the VS Code session root by splitting the path on the native separator and finding the `logs/<timestamp>` landmark; depth-independent and correct on macOS, Linux, and Windows.
- **`src/ui/dashboardMessages.ts`** — shared TypeScript union types (`HostToWebviewMessage`, `WebviewToHostMessage`) imported by both the host and the WebView; erased at runtime.
- **`src/mcp/server.ts`** — MCP server exposing `get_usage_summary`, `get_model_efficiency`, and `get_anomaly_report` tools; entry point is `bin/mcp-server.js`, registered via `contributes.mcpServers`.

## Log File Discovery

`parseCopilotLogs` receives `context.logUri` and calls `findSessionRoot` (from `src/utils/logPaths.ts`) to locate the VS Code session root by splitting the path on the native separator and finding the `logs/<timestamp>` landmark. It then reads **up** one level to the base log dir and scans the **N most recent** session directories (configurable via `copilot-insight.maxSessionDirs`, default 10) for subdirectories named `GitHub.copilot`, `github.copilot`, or `GitHub.copilot-nightly`.

## Build & Dev Workflow

| Task | Command |
|---|---|
| One-shot dev build | `npm run compile` (type-check → lint → esbuild) |
| Watch mode (dev) | `npm run watch` (parallel esbuild + tsc via `npm-run-all`) |
| Production bundle | `npm run package` (minified, no sourcemap) |
| Run tests | `npm test` (compiles tests + extension + lint, then `vscode-test`) |
| Lint only | `npm run lint` |

Output goes to `dist/extension.js` (CJS, `vscode` external) and `dist/webview/` (webview bundle, built from `webview/dashboard.ts` using `tsconfig.webview.json`).

## Key Conventions

- **Linter is Biome, not ESLint.** Config in `biome.json`; runs only on `src/**/*.ts`. Rules are non-recommended: `useBlockStatements`, `useNamingConvention`, `useThrowOnlyError`, `noDoubleEquals` (all `warn`).
- **Type-checking is separate from bundling.** `esbuild.js` never invokes `tsc`; type errors surface only via `check-types` / `watch:tsc`.
- **WebviewPanel CSP:** uses a per-request `nonce` to allow only the bundled webview script; `localResourceRoots` is limited to `dist/webview/`.
- **Error handling in parser:** every `fs` call is wrapped in `try/catch` that silently skips unreadable files/dirs — preserve this pattern.
- **HTML generation:** `src/ui/copilotUsageHtml.ts` generates the HTML shell that loads the webview bundle. `src/ui/dashboardPayload.ts` builds the data payload sent to the WebView via `postMessage`.
- **Dashboard messages:** always use the typed unions in `src/ui/dashboardMessages.ts` for WebView ↔ Host communication; never use ad-hoc string `type` fields.

## Adding New Commands

1. Register in `package.json` under `contributes.commands`.
2. Call `context.subscriptions.push(vscode.commands.registerCommand(...))` in `activate()`.
3. No activation events needed — `activationEvents: []` (VS Code 1.109+ auto-activates).

## Post-Implementation Checks

After making any code changes, always run the following commands in order and fix any errors before finishing:

```bash
npm run check-types
npm run lint
npm run format
xvfb-run -a npm test
```

- **`npm run check-types`** — TypeScript type-check (no emit). Fix all type errors before proceeding.
- **`npm run lint`** — Biome linter on `src/**/*.ts`. Fix or suppress all warnings/errors.
- **`npm run format`** — Biome formatter check on `src/**/*.ts`. Run `npm run format:fix` to auto-fix formatting issues.
- **`xvfb-run -a npm test`** — Compiles tests and runs the full test suite via `vscode-test`. **All tests must pass.** VS Code requires a display; use `xvfb-run -a` in headless environments (CI uses this too). Do **not** skip or ignore test failures.
