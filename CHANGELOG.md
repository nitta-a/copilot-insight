# Change Log

All notable changes to the "copilot-insight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.12] - 2026-03-06

### Added
- 📋 **Planning Success Rate Analytics** — the Agent Intelligence Overview now includes a dedicated **Planning & Execution** section that surfaces four new metrics: Plans Proposed, Plans Executed (led to file edits), Planning Success Rate, and User Choices (in-plan interactions); the section is shown automatically when plan activity is detected in the logs
- 🧮 **Planning fields in log parser** — `logContentParser` tracks `planCount`, `executedPlanCount`, and `userChoicesInPlan` by recognising `agent/plan`, `strategy/propose`, and `choice_selected` log events
- 📊 **Planning stats in dashboard payload** — `buildDashboardPayload` exposes `planCount`, `executedPlanCount`, `planSuccessRate`, and `userChoicesInPlan` in the `AgenticOverview` shape forwarded to the WebView
- 📝 **Planning section in Markdown report** — `reportGenerator` now emits a Planning & Execution block (strategic plans proposed, plans executed, success rate, user choices) when plan activity is present
- 🔌 **Typed planning fields** — `AgenticStats` in `dashboardMessages.ts` declares the four new planning fields so both the host and the WebView share the same contract

## [1.0.11] - 2026-03-04

### Added
- 📝 **Professional Markdown report** — `Copilot Insight: Export Report (Markdown)` now produces a structured, shareable document with six sections: Executive Summary, Acceptance Analysis, Language Breakdown, Model Performance, Velocity/Flow, and ROI Estimation; pre-computed values from `buildDashboardPayload` are forwarded to ensure dashboard ↔ report consistency
- 🧩 **Dashboard payload builder** — extracted `buildDashboardPayload` into `src/ui/dashboardPayload.ts` as a standalone, side-effect-free function; enables full unit-test coverage without a VS Code process
- 🔌 **Typed message protocol** — `src/ui/dashboardMessages.ts` formalises the WebView ↔ Extension Host bidirectional communication with explicit TypeScript union types (`HostToWebviewMessage`, `WebviewToHostMessage`)
- 🗂️ **Reliable log discovery** — `src/utils/logPaths.ts` introduces `findSessionRoot`, which locates the VS Code session root by scanning path segments for the `logs/<timestamp>` landmark; works correctly regardless of the number of intermediate directories and on both macOS and Windows
- 🧪 **Expanded test coverage** — new test suites for `logPaths` (`findSessionRoot`), MCP server tools, dashboard payload builder, and top-level `utils` helpers

### Changed
- **`parseCopilotLogs`** — uses `findSessionRoot` (segment-based) instead of three `path.dirname()` calls for session root location; more reliable across all VS Code log path layouts
- **WebView** — `enableScripts: true`; the webview bundle (`dist/webview/`) is built by `tsconfig.webview.json` and includes Chart.js + React chart components served via `localResourceRoots`

## [1.0.10] - 2026-03-04

### Changed
- 📄 **README** — updated documentation to reflect current features: removed the date-range period reference (eliminated in 1.0.9), removed the unused `defaultDisplayDays` configuration entry, and added the Real-time Status Bar indicator and MCP Server integration to the feature list

## [1.0.9] - 2026-03-04

### Removed
- 🗓️ **Date range selector** — removed the dynamic date-range inputs and the `copilot-insight.changeDailyUsagePeriod` command; the dashboard now always shows the full span of available log data, eliminating the infinite re-render loop that the date-range state restoration triggered

### Changed
- **`buildDashboardPayload`** — removed `startDate`/`endDate` parameters; the timeline now includes all entries from `stats.byDate` unconditionally
- **WebView state** — `vscode.setState`/`getState` now only persists `currentTab`; `DOMContentLoaded` no longer issues a `changePeriod` roundtrip on restore

## [1.0.8] - 2026-03-04

### Added
- 📡 **Context Effectiveness Dashboard** — new section in the Flow tab tracks which Copilot context sources (Active File, Workspace, Symbol, Embeddings, etc.) are contributing to accepted completions, with shown/accepted counts and per-source acceptance rate
- 🗓️ **Dynamic date range selector** — replaced the fixed 7 / 14 / 30-day period buttons with HTML5 date-range inputs; the WebView defaults to the full available data range on first render and updates charts on change without a full reload

### Changed
- 💾 **Reimplemented export** — CSV / JSON / Markdown report exports now include agentic & subagent metrics and the context-effectiveness data added in this release; per-tab export context is preserved correctly

## [1.0.7] - 2026-03-03

### Added
- 📊 **Model Depth & Velocity Chart** — new `ComposedChart` in the Agent Intelligence Overview showing per-model agentic depth (Avg Calls/Loop, bars) alongside velocity (seconds per autonomous action, line) on dual Y-axes
- 🫧 **Agentic Efficiency Scatter Plot** — bubble scatter plot correlating Avg Calls/Loop (X) with Completion Rate % (Y), bubble size encoding autonomous session duration; top-right quadrant highlights models that think deeply *and* complete reliably
- Extended `autonomousRatioByModel` payload with three new per-model fields: `avgLoopActions`, `completionRate`, and `autonomousDurationMs`

## [1.0.6] - 2026-03-02

### Changed
- 🔧 Lowered VS Code engine requirement to `^1.105.0` for broader compatibility

## [1.0.5] - 2026-03-02

### Changed
- 💾 **Workspace-aware export** — all Save dialogs (CSV, JSON, Markdown report, PNG screenshot) now default to the first workspace folder instead of the current working directory
- 📅 **Date-stamped filenames** — exported files now include today's date in the filename (e.g., `copilot-usage-2026-03-02.csv`) so exports from different sessions never overwrite each other

## [1.0.4] - 2026-03-01

### Added
- 📊 **Tab-based dashboard** — dashboard is now split into three focused tabs:
  - **Overview (ROI)**: summary cards (true acceptance rate, estimated minutes saved, best model), dynamic Insights section, and dynamic Weekly Trend comparison
  - **Health (Diagnostics)**: True Acceptance Rate Timeline (Chart.js bar + line combo with anomaly highlighting), daily usage, model breakdown, latency distribution, session table
  - **Flow (Velocity)**: Flow & Velocity Correlation scatter plot (KPM vs completions accepted, red dots for flow-disruption windows), activity heatmaps, context-source insights
- 🖼️ **Export Chart (PNG)** — one-click export of the current Chart.js chart to a PNG file via the dashboard toolbar
- ⚡ **Dynamic period updates** — changing the display period (7 / 14 / 30 days) updates only the relevant chart data via `postMessage` without a full WebView reload
- 🧠 **ROI estimation** — summary card shows estimated developer minutes saved based on accepted completions
- 🏆 **Best model card** — highlights the best-performing inline completion model derived from cross-language model-performance data

## [1.0.3] - 2026-03-01

### Added
- 🔌 MCP server integration — Copilot Insight now exposes an MCP server (`bin/mcp-server.js`) registered via `contributes.mcpServers`; the server auto-resolves the global storage path so clients connect without manual configuration
- ⚡ Event batching — `EventTracker` now batches inline-completion events before forwarding them to the `dbWorker` over IPC, reducing message overhead and improving performance under high suggestion volumes
- 🗜️ Data retention & aggregation — `InMemoryAnalyticsDb` gains a `compact(ttlMs)` method that converts events older than the TTL into daily aggregates, keeping memory usage bounded over long sessions

## [1.0.2] - 2026-03-01

### Changed
- 🔴 Anomaly points in the Acceptance Rate timeline chart now use a hardcoded bright red (`#FF4B4B`) instead of the theme-derived `--vscode-charts-red`, ensuring they remain visually distinct in all VS Code themes (light, dark, high-contrast)
- Anomaly points now have a border width of `2` (normal points `1`) for additional emphasis

## [1.0.1] - 2026-03-01

### Added
- 💡 Insights section — auto-generated summary observations (weekly rate trend, best language, peak hour, chat vs inline ratio)
- 📅 Daily acceptance rate trendline — orange rate bar added to Daily Usage chart
- 🤖 Model acceptance rate comparison — Inline Completion Model chart now shows shown/accepted/rate per model
- CSV export: added `# Chat Intent` and `# Activity by Hour` sections
- CSV export: `# Inline Completion Model` section now includes Shown, Accepted, and Rate columns

### Changed
- `byModel` data structure changed from `Map<string, number>` to `Map<string, LanguageStat>` for shown/accepted tracking
- JSON export: `byModel` entries now include `{ shown, accepted }` instead of a plain count

## [1.0.0] - 2026-02-28

### Added
- Initial stable release
- Copilot usage statistics dashboard (suggestions shown / accepted / acceptance rate)
- Breakdown by language and date
- Weekly trend comparison
- Activity bar view with dashboard button
- CSV / JSON export
- Extension icon and activity bar icon