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
│   ├── log/
│   │   ├── copilotLogParser.ts   # Orchestrates log discovery and delegates to logFileReader / logContentParser
│   │   ├── logFileReader.ts      # File-system utilities: session dir sorting, .log file reading
│   │   └── logContentParser.ts  # Line-by-line parser for both JSON-embedded and plain-text log formats
│   ├── ui/
│   │   ├── copilotUsagePanel.ts  # Singleton WebviewPanel (createOrShow pattern)
│   │   ├── copilotUsageHtml.ts   # Generates the HTML string rendered in the WebviewPanel
│   │   ├── copilotUsageTreeProvider.ts  # TreeDataProvider powering the "Copilot Usage" sidebar view
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
│   │   └── reportGenerator.ts
│   ├── db/
│   │   ├── dbSchema.ts
│   │   └── duckdbClient.ts       # Placeholder DuckDB client interface (not yet wired)
│   └── test/                     # Mocha/vscode-test test files (*.test.ts)
│       ├── extension.test.ts
│       ├── log/
│       │   └── logContentParser.test.ts
│       ├── ui/
│       │   ├── copilotUsageTreeProvider.test.ts
│       │   └── statusBarIndicator.test.ts
│       ├── events/
│       │   ├── eventSchema.test.ts
│       │   ├── eventStorage.test.ts
│       │   ├── eventTracker.test.ts
│       │   └── inlineCompletionWrapper.test.ts
│       ├── metrics/
│       │   ├── metricsEngine.test.ts
│       │   └── weeklyTrend.test.ts
│       ├── export/
│       │   ├── exportStats.test.ts
│       │   └── reportGenerator.test.ts
│       └── db/
│           ├── dbSchema.test.ts
│           └── duckdbClient.test.ts
├── dist/                         # Build output — extension.js (CJS bundle, git-ignored)
├── biome.json                    # Biome linter + formatter config
├── esbuild.js                    # esbuild bundler script (dev and production modes)
├── package.json                  # Extension manifest, commands, configuration, scripts
└── tsconfig.json                 # TypeScript compiler options (target: ES2022, module: Node16)
```

## Architecture

Three-layer pipeline:

1. **`src/log/copilotLogParser.ts`** — reads `.log` files from VS Code's extension host log directory, parses both JSON-embedded lines (matching `/\{.*\}/`) and plain-text lines, and accumulates `CopilotUsageStats`.
2. **`src/ui/copilotUsagePanel.ts`** — singleton `WebviewPanel` via `createOrShow` pattern; holds `static currentPanel` reference; `enableScripts: false` (no JS in webview).
3. **`src/ui/copilotUsageHtml.ts`** — generates the HTML string directly (no templating library); uses VS Code CSS variables (`var(--vscode-foreground)`, `var(--vscode-charts-blue)`, etc.) for automatic theme support.

`extension.ts` wires commands to the pipeline using `vscode.window.withProgress` for the parsing step.

## Log File Discovery

`parseCopilotLogs` receives `context.logUri` and traverses **up** three `path.dirname()` calls to reach the base log dir, then scans the **5 most recent** session directories for subdirectories named `GitHub.copilot`, `github.copilot`, or `GitHub.copilot-nightly`.

## Build & Dev Workflow

| Task | Command |
|---|---|
| One-shot dev build | `npm run compile` (type-check → lint → esbuild) |
| Watch mode (dev) | `npm run watch` (parallel esbuild + tsc via `npm-run-all`) |
| Production bundle | `npm run package` (minified, no sourcemap) |
| Run tests | `npm test` (compiles tests + extension + lint, then `vscode-test`) |
| Lint only | `npm run lint` |

Output goes to `dist/extension.js` (CJS, `vscode` external).

## Key Conventions

- **Linter is Biome, not ESLint.** Config in `biome.json`; runs only on `src/**/*.ts`. Rules are non-recommended: `useBlockStatements`, `useNamingConvention`, `useThrowOnlyError`, `noDoubleEquals` (all `warn`).
- **Type-checking is separate from bundling.** `esbuild.js` never invokes `tsc`; type errors surface only via `check-types` / `watch:tsc`.
- **WebviewPanel CSP:** `default-src 'none'; style-src 'unsafe-inline'` — no external resources, no scripts, inline styles only.
- **Error handling in parser:** every `fs` call is wrapped in `try/catch` that silently skips unreadable files/dirs — preserve this pattern.
- **HTML generation:** build the HTML string in `src/ui/copilotUsageHtml.ts`, not in `src/ui/copilotUsagePanel.ts`. Call `escapeHtml()` for any user-derived data inserted into HTML.

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
