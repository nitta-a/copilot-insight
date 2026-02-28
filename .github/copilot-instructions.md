# Copilot Instructions

## Overview

VS Code extension that parses GitHub Copilot's local log files and displays usage statistics (suggestions shown/accepted, acceptance rate by language and date) in a WebviewPanel.

## Architecture

Three-layer pipeline:

1. **`src/copilotLogParser.ts`** — reads `.log` files from VS Code's extension host log directory, parses both JSON-embedded lines (matching `/\{.*\}/`) and plain-text lines, and accumulates `CopilotUsageStats`.
2. **`src/copilotUsagePanel.ts`** — singleton `WebviewPanel` via `createOrShow` pattern; holds `static currentPanel` reference; `enableScripts: false` (no JS in webview).
3. **`src/copilotUsageHtml.ts`** — generates the HTML string directly (no templating library); uses VS Code CSS variables (`var(--vscode-foreground)`, `var(--vscode-charts-blue)`, etc.) for automatic theme support.

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
- **HTML generation:** build the HTML string in `copilotUsageHtml.ts`, not in `copilotUsagePanel.ts`. Call `escapeHtml()` for any user-derived data inserted into HTML.

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
npm test
```

- **`npm run check-types`** — TypeScript type-check (no emit). Fix all type errors before proceeding.
- **`npm run lint`** — Biome linter on `src/**/*.ts`. Fix or suppress all warnings/errors.
- **`npm run format`** — Biome formatter check on `src/**/*.ts`. Run `npm run format:fix` to auto-fix formatting issues.
- **`npm test`** — Compiles tests and runs the full test suite via `vscode-test`. All tests must pass.
