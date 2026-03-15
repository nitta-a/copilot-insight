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
│   │   ├── copilotLogParser.ts       # Orchestrates log discovery and delegates to logFileReader / logContentParser
│   │   ├── logFileReader.ts          # File-system utilities: session dir sorting, .log file reading
│   │   ├── logContentParser.ts       # Top-level parser coordinator (delegates to parsers/ sub-modules)
│   │   ├── chatSessionTitleReader.ts # Parses VS Code Copilot JSONL mutation log to reconstruct chat session titles
│   │   ├── cliLogReader.ts           # Discovers and parses GitHub Copilot CLI session logs (~/.copilot/session-state/)
│   │   ├── keywordExtractor.ts       # Tokenises chat titles / CLI prompts; returns top-N terms (stop-word filtered)
│   │   ├── statsSnapshotStorage.ts   # Serialises/deserialises CopilotUsageStats to globalStoragePath/usage-stats.json
│   │   └── parsers/
│   │       ├── jsonLogParser.ts      # JSON-embedded log line parser (lines matching /\{.*\}/)
│   │       ├── textLogParser.ts      # Plain-text inline-completion log line parser
│   │       └── parserHelpers.ts      # Shared accumulation utilities used by both parsers
│   ├── ui/
│   │   ├── copilotUsagePanel.ts      # Singleton WebviewPanel (createOrShow pattern)
│   │   ├── copilotUsageHtml.ts       # Generates the HTML shell that loads the webview bundle
│   │   ├── copilotUsageTreeProvider.ts  # TreeDataProvider powering the "Key Performance Indicators" sidebar view
│   │   ├── dashboardMessages.ts      # Shared WebView ↔ Extension Host message types (HostToWebviewMessage, WebviewToHostMessage)
│   │   ├── dashboardPayload.ts       # Standalone buildDashboardPayload() function (no VS Code deps; unit-testable)
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
│   ├── dashboard.ts              # Main dashboard orchestrator: tab switching, Chart.js timeline, export handling
│   ├── dashboardUtils.ts         # Pure formatting/escaping helpers shared across dashboard modules
│   ├── htmlBuilders.ts           # Pure HTML-string builder functions (no DOM side-effects)
│   └── charts/
│       ├── AgenticEfficiencyScatterPlot.tsx  # React scatter plot (Avg Calls/Loop vs Completion Rate)
│       ├── AutonomyEvolutionChart.tsx        # React ComposedChart (daily Autonomous Volume + Thinking Depth)
│       ├── ModelAutonomyLeverageMap.tsx      # React bubble chart (Autonomous Ratio × Duration, size = actions)
│       ├── ModelDepthVelocityChart.tsx       # React ComposedChart (agentic depth bars + velocity line)
│       └── ModelROIEfficiencyMap.tsx         # React bubble chart (Acceptance Rate × Time Saved per model)
├── test/                         # Mocha/vscode-test test files (*.test.ts)
│   ├── extension.test.ts
│   ├── utils.test.ts
│   ├── log/
│   │   ├── chatSessionTitleReader.test.ts
│   │   ├── cliLogReader.test.ts
│   │   ├── keywordExtractor.test.ts
│   │   ├── logContentParser.test.ts
│   │   ├── logFileReader.test.ts
│   │   ├── logPaths.test.ts
│   │   └── statsSnapshotStorage.test.ts
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
│       ├── dbWorker.test.ts
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

1. **`src/log/copilotLogParser.ts`** — reads `.log` files from VS Code's extension host log directory, parses both JSON-embedded lines (via `parsers/jsonLogParser.ts`) and plain-text lines (via `parsers/textLogParser.ts`), and accumulates `CopilotUsageStats`. Also coordinates chat session title resolution and CLI log ingestion.
2. **`src/ui/dashboardPayload.ts`** — `buildDashboardPayload()` converts raw `CopilotUsageStats` + optional advanced-metrics into the typed `DashboardPayload` shape consumed by the WebView; no VS Code dependencies, fully unit-testable.
3. **`src/ui/copilotUsagePanel.ts`** — singleton `WebviewPanel` via `createOrShow` pattern; holds `static currentPanel` reference; `enableScripts: true`; serves the bundled webview from `dist/webview/` via `localResourceRoots`.
4. **`webview/dashboard.ts`** — main dashboard orchestrator (bundled separately by `tsconfig.webview.json`); manages tab switching across **Overview**, **Flow**, **Agent Intelligence**, **Prompt Insights**, and **Sessions** tabs; renders Chart.js timeline and export charts; communicates with the host via `vscode.postMessage` using the typed protocol in `dashboardMessages.ts`. HTML fragments are generated by `htmlBuilders.ts`; utility formatting functions live in `dashboardUtils.ts`.

`extension.ts` wires commands to the pipeline using `vscode.window.withProgress` for the parsing step.

## Key Modules

- **`src/utils/logPaths.ts`** — `findSessionRoot(fsPath)` locates the VS Code session root by splitting the path on the native separator and finding the `logs/<timestamp>` landmark; depth-independent and correct on macOS, Linux, and Windows.
- **`src/ui/dashboardMessages.ts`** — shared TypeScript union types (`HostToWebviewMessage`, `WebviewToHostMessage`) imported by both the host and the WebView; erased at runtime.
- **`src/mcp/server.ts`** — MCP server exposing `get_usage_summary`, `get_model_efficiency`, and `get_anomaly_report` tools; entry point is `bin/mcp-server.js`, registered via `contributes.mcpServers`.
- **`src/log/chatSessionTitleReader.ts`** — parses the VS Code Copilot JSONL mutation log to reconstruct human-readable chat session titles used in the Sessions tab.
- **`src/log/cliLogReader.ts`** — discovers and parses GitHub Copilot CLI session JSONL files under `~/.copilot/session-state/`; contributes `CliStats` (per-date prompts and output tokens) to the dashboard.
- **`src/log/keywordExtractor.ts`** — tokenises chat session titles and CLI prompt text, filters English stop words, and returns the top-N most frequent terms for the Tag Cloud widget.
- **`src/log/statsSnapshotStorage.ts`** — serialises `CopilotUsageStats` to `globalStoragePath/usage-stats.json` so usage history survives VS Code restarts without re-parsing all log files.
- **`src/log/parsers/`** — three focused modules split from the original `logContentParser.ts`: `jsonLogParser.ts` handles JSON-embedded lines, `textLogParser.ts` handles plain-text inline-completion lines, and `parserHelpers.ts` provides shared accumulation utilities.

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
