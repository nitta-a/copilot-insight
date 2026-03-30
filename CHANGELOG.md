# Change Log

All notable changes to the "copilot-insight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.
## [1.1.8] - 2026-03-30

### Removed
- 🗑️ **Context Window Insight removed** — the Context Window Insight feature has been removed to simplify the codebase and reduce surface area. This includes:
  - `ContextFreshnessMeter` Web Component (`<copilot-freshness-meter>`)
  - `ProjectPlanList` Web Component (`<copilot-project-plan-list>`)
  - `src/utils/contextFileLocator.ts` — context-file discovery and freshness scoring utilities
  - All related fields removed from `CopilotUsageStats`, `DashboardPayload`, and associated parsers/storage/export modules
  - Context-window insight tests, snapshot fields, and dashboard message types cleaned up

## [1.1.7] - 2026-03-30

### Changed
- 📦 **Dependency updates** — updated dev and production dependencies to their latest versions:
  - `@biomejs/biome` → `^2.4.9`
  - `@napi-rs/cli` → `^3.6.0`
  - `typescript` → `^6.0.2`
  - `@modelcontextprotocol/sdk` → `^1.28.0`
  - `recharts` → `^3.8.1`
  - `serialize-javascript` override → `>7.0.4`
  - `path-to-regexp` (indirect) → `8.4.0`
  - `picomatch` (indirect) → `2.3.2`

## [1.1.6] - 2026-03-27

### Changed
- 🚀 **Release workflow — GitHub Release trigger with pre-release support** — the `release.yml` CI workflow now triggers on the `published` event of a GitHub Release instead of a tag push; when the release is marked as a pre-release, `vsce publish --pre-release` is used automatically so pre-release builds reach the VS Code Marketplace correctly

## [1.1.3] - 2026-03-26

### Reverted
- Reverted all changes introduced in v1.1.2; this release is functionally equivalent to v1.1.1
## [1.1.1] - 2026-03-26

### Changed
- ⚡ **Prompt Insights tab — lazy auto-load** — the manual "Load Prompt Insights" button has been removed; the tab now auto-loads its data the first time it is activated, matching the UX pattern of the other tabs and eliminating an unnecessary extra click
- ⚡ **Sessions tab — lazy auto-load** — the manual "Load Sessions" button has been removed; session data is fetched automatically when the Sessions tab is first opened, keeping the experience consistent and reducing friction when drilling into chat threads

## [1.1.0] - 2026-03-25

### Added
- ⏱️ **Timing diagnostics** — new `copilot-insight.enableTimingLogs` setting (default: `false`) emits detailed `[TIMING]` entries to the **Copilot Insight** Output panel during log parsing; each phase is individually timed (session discovery, per-file parse, CLI stats, DB operations, advanced-metrics computation) so slow parses can be pinpointed quickly; slow files exceeding 100 ms are flagged with their path and whether the native or JS parser was used

### Changed
- ♻️ **Shared `OutputChannel` singleton** — `getOutputChannel()` extracted into a new `src/log/logChannel.ts` module (`getLogChannel()` / `isTimingLogsEnabled()`) shared by `copilotLogParser.ts`, `logFileReader.ts`, and `extension.ts`, eliminating duplicate channel-creation logic
- ⚡ **`computeTrueAcceptanceRate` — O(A×C) → O(C log C + A log C)** — `textChanges` array is now pre-sorted by timestamp and a binary-search locates the window start index for each accepted completion, eliminating the inner linear scan over all change events; `Date` parsing is performed once per event rather than on every comparison
- ⚡ **`computeVelocityAnalysis` — sliding-window optimisation** — event timestamps are pre-computed and the sorted event list is shared across all KPM windows; a single left-boundary pointer advances monotonically instead of filtering the full event list on every iteration; `windowMs / 60_000` is hoisted out of the loop
- ⚡ **`parseLogDirectory` / `parseRemoteExthostLog` result shape** — `parseLogFile` now returns `{ success, elapsedMs, usedNative }` instead of a bare `boolean`; callers use the structured result to count parsed files and, when timing is enabled, surface slow-file warnings per directory

## [1.0.26] - 2026-03-24

### Changed
- 🔒 **Lit Web Component migration (security & modernisation)** — all remaining `innerHTML`-based HTML string builders in `htmlBuilders.ts` have been replaced with reactive [Lit](https://lit.dev/) Web Components, eliminating the entire class of stored-XSS vectors that arise from injecting unsanitised data into `innerHTML`; affected components:
  - **`<copilot-summary-cards>`** (`SummaryCards.ts`) — replaces `buildSummaryCardsHtml`; renders the KPI stat-card grid with Lit templating
  - **`<copilot-insights-list>`** (`InsightsList.ts`) — replaces `buildInsightsHtml`; renders the 💡 Insights section
  - **`<copilot-refresh-analysis>`** (`RefreshAnalysis.ts`) — replaces `buildRefreshAnalysisHtml`; renders the Refresh ROI analysis table
  - **`<copilot-agent-intelligence-overview>`** (`AgentIntelligenceOverview.ts`) — replaces `buildAgentIntelligenceOverviewHtml`; renders the full Agent Intelligence section including stat cards, model tables, CLI tool efficiency, agent types, feature signals, and planning metrics; uses light DOM so React chart containers remain discoverable via `document.getElementById`
  - **`<copilot-thread-detail>`** (`ThreadDetail.ts`) — replaces `buildThreadDetailHtml`; renders the step timeline of a selected Copilot session thread; exports `getSelectableThreadsSorted` utility used by `dashboard.ts` to synchronise `selectedThreadId` state after fallback
- 🗑️ **`htmlBuilders.ts` cleaned up** — functions migrated to Lit components have been removed from `htmlBuilders.ts`, shrinking the module by ~350 lines; remaining string-builder utilities that have no XSS risk (e.g. skeleton loaders, simple structural wrappers) are retained

## [1.0.25] - 2026-03-22

### Added
- 🔢 **Token consumption tracking** — `CopilotUsageStats` now records `totalPromptTokens`, `totalCompletionTokens`, and a per-model `tokensByModel` map; values are extracted from the `promptTokens` / `prompt_tokens` / `numTokens` (prompt) and `completionTokens` / `completion_tokens` (completion) fields present in JSON log entries, covering both inline-completion and chat-request events
- 📊 **Finish-reason distribution** — a new `finishReasonCounts` map captures `[streamChoices] finish reason:` log lines so you can see how often completions end normally (`stop`) versus being cut off by the context window (`length`) or other causes; the dashboard renders a breakdown card in the Model Intelligence section
- 🤖 **CLI agentic detail** — three new optional fields on `CopilotUsageStats` track GitHub Copilot CLI agentic behaviour: `cliToolExecutions` (per-tool call counts with success/fail split), `cliReasoningTokens` (cumulative length of reasoning text in assistant messages), and `cliAgentTypes` (sub-agent type distribution); extracted from CLI JSONL session files

### Fixed
- 🖼️ **PNG export — recharts SVG colour attributes** — `_rewriteUnsupportedCssInClone` now strips unsupported CSS colour functions (e.g. `color(display-p3 …)`) from SVG presentation attributes (`fill`, `stroke`, `stop-color`, `flood-color`, `lighting-color`) in addition to inline `style` attributes; recharts and other SVG libraries resolve CSS variables at render time and embed the result directly as element attributes, which previously caused `html2canvas` to throw a hard parse error when exporting charts that used `oklab`/`display-p3` theme colours
- 🔒 **XSS in finish-reason breakdown** — `renderFinishReasonBreakdown` now escapes `entry.name` through `escapeHtml` before injecting it into an `innerHTML` string, preventing a stored-XSS vector if a malicious log entry contained HTML in the finish-reason field

## [1.0.24] - 2026-03-22

### Fixed
- 🔢 **Context source count now includes all log formats** — the reference-count field (`usedReferences` / `references` / `contextReferences` / `attachedFiles`) is recorded whenever it is present in a JSON log entry, independent of whether the event name matches the known chat-turn patterns; sessions with unrecognised event names no longer silently drop their context attachment data
- 📊 **Context Leverage histogram includes all sessions** — sessions from legacy snapshots or log files where `referenceCount` was not previously tracked are now counted in the "0 sources" bucket instead of being excluded, giving a more complete picture of context usage
- 🏷️ **"files" → "sources" terminology** — bucket labels, chart title, tooltip, and meter labels updated from "N files" to "N sources" (e.g. "0 sources", "1 source", "4+ sources") to accurately reflect that context attachments include code snippets, workspace symbols, and other context items — not just attached files

## [1.0.23] - 2026-03-20

### Added
- 🦀 **NAPI-RS native addon** — log-parsing engine migrated from WebAssembly (wasm-bindgen) to a NAPI-RS compiled native Node.js addon (`native-parser/`); `NativeStats` tracks `total_shown`, `total_accepted`, `total_chat`, `subagent_requests`, `plan_count`, per-model shown/accepted maps (`by_model_shown`, `by_model_accepted`), per-date counts (`by_date`), per-hour counts (`by_hour`), raw latency values (`latencies`), and context-source counts (`by_context_source`)
- ⚡ **Synchronous native fast path** — `parseLogFileNative` passes the file path directly to Rust so all file I/O is performed in the native addon without Node.js reading the file; `parseLogChunkNative` handles in-memory content; both execute synchronously for lower overhead compared to the previous async Wasm path
- 🔌 **Transparent JS fallback** — `logContentParser.ts` tries the native addon first via the typed `nativeBridge.ts` bridge; when the addon is absent (not yet built) the existing JS readline line-by-line parsers handle all parsing without any behaviour change
- 🧪 **18 Rust unit tests** — comprehensive test suite in `native-parser/src/lib.rs` covering all event types (`shown`, `accepted`, `chat-request`, `subagent-request`, `plan-proposed`), model-priority resolution, JSON embedded-line extraction, and plain-text `[fetchCompletions]` / `ccreq:` pattern matching

### Changed
- **`nativeBridge.ts`** — new TypeScript bridge (`src/log/nativeBridge.ts`) lazily loads the NAPI-RS `.node` module and exposes `loadNativeModule`, `parseLogChunkNative`, and `parseLogFileNative`; returns `null` gracefully when the addon is not built so the rest of the extension is unaffected
- **Build** — `npm run build:native` compiles the Rust crate in `native-parser/` to a platform-specific `.node` file using `@napi-rs/cli`; the Wasm build (`npm run build:wasm`) and wasm-parser directory remain in the repository for reference

## [1.0.22] - 2026-03-19

### Added
- 🦀 **Wasm log-parser production upgrade** — the Rust/Wasm aggregation engine graduates from PoC to production; `WasmStats` now tracks `total_shown`, `total_accepted`, `total_chat`, `subagent_requests`, `plan_count`, and per-model shown/accepted maps (`by_model_shown`, `by_model_accepted`); JSON-embedded log lines are deserialized via a typed `LogEntry` struct; model identity is resolved through a six-field priority chain (`model_name` → `modelId` → `model` → `engineId` → `engineName` → `engine`)
- ⚡ **Transparent JS fallback** — `parseLogContent` / `parseLogFile` are now `async`; the Wasm fast path is tried first and `mergeWasmResults()` additively folds the results into `ParsingContext`; when the Wasm module is absent the existing JS line-by-line parsers handle all lines without any behaviour change
- 🔤 **Plain-text detection in Wasm** — the Rust engine now also recognises `[fetchCompletions]` and `ccreq:` markers in plain-text log lines, covering inline-completion events that lack a JSON envelope
- 🧪 **10 Rust unit tests** — new test suite inside `wasm-parser/src/lib.rs` covers all event types (`shown`, `accepted`, `chat-request`, `subagent-request`, `plan-proposed`), model-priority resolution, embedded-JSON extraction, and plain-text pattern matching

### Changed
- **`WasmParseResult` / `RawWasmResult`** — both TypeScript types updated in `src/log/wasmBridge.ts` to expose all 7 aggregation fields with camelCase ↔ snake_case mapping

## [1.0.21] - 2026-03-19

### Added
- ⚡ **Lazy loading for Prompt Insights & Sessions tabs** — dashboard initial render no longer blocks on expensive SQLite workspace-storage reads; Prompt Insights and Sessions tabs render a "Load Data" button placeholder on first paint and fetch their payloads on demand when the tab is first opened, eliminating the startup delay for users with large Copilot histories
- 🔄 **Paginated initial parse** — dashboard first load now parses only the 5 most recent log-session directories (was all available sessions); a **"🕐 Load Historical Data"** button appears in the Health tab when older data exists, triggering a full re-parse on demand; manual Refresh still performs a complete parse

### Changed
- **`ParseCopilotLogsOptions`** — new `limitSessions?: number` field; passed to `getSortedSessionDirs` to cap the initial scan without touching config defaults
- **`DashboardPayload`** — new `hasMoreData: boolean` field drives the Load Historical Data button visibility; 7 heavy Prompt Insights / Sessions fields moved to separate `PromptInsightsData` and `SessionsData` lazy payloads
- **`WebviewToHostMessage`** — new `LoadMoreDataMessage { type: "loadMoreData" }` and `RequestTabDataMessage` allow the WebView to pull deferred data on demand
- **`AdvancedMetrics`** — extended with `logUri?: vscode.Uri`, `hasMoreData?: boolean`, and `logBaseDir?: string` for deferred session loading

## [1.0.20] - 2026-03-19

### Fixed
- 🏆 **Top Plan Model KPI now correctly reflects agentic activity** — `topPlanModel` now counts both legacy `plan-proposal` signals and modern `panel/editAgent` chat-request signals, ensuring the KPI card surfaces the model actually driving agentic coding sessions in current Copilot versions
- 🏷️ **Plan signals carry model name** — `trackPlanningStats` now accepts an optional `modelName` parameter; JSON log lines pass the extracted model, and ccreq-style text log lines extract the model from the `| success | <model> | <ms> |` pattern before recording the signal, so plan-proposal entries are correctly attributed to the generating model
- 🔤 **KPI card label updated** — the Top Plan Model card subtitle now reads `N plan & agent calls` (was `N model-tagged proposals`) to accurately describe the combined signal set

## [1.0.19] - 2026-03-17

### Added
- 📊 **Context Leverage analysis** — new mixed chart in the Prompt Insights tab shows how the number of context references (files, workspace symbols, embeddings, etc.) attached to a chat request correlates with code-acceptance rate; sessions are bucketed into five ranges (0, 1, 2–3, 4–5, 6+ files) so you can immediately see whether providing more context leads to better results
- 🔄 **Turn Count & Resolution Rate analysis** — new Turn Churn chart in the Prompt Insights tab plots the distribution of multi-turn chat sessions alongside their resolution rate; tracks per-session turn count and code-acceptance state in `chatSessionStates`; `statsSnapshotStorage` now serialises/deserialises the new map so the data survives VS Code restarts

### Fixed
- 🪟 **WSL session title discovery** — `chatSessionTitleReader` now enumerates mounted Windows drives under `/mnt/` and reads VS Code (and VS Code Insiders) workspace-storage roots from the Windows-side AppData path; chat session titles are correctly resolved when VS Code Remote/WSL is used and the renderer writes JSONL to the Windows file system

## [1.0.18] - 2026-03-15

### Added
- 💬 **Prompt Insights tab** — new dedicated tab in the dashboard that consolidates all prompt-analysis widgets (Tag Cloud, Intent Command donut, and Prompt Length scatter chart); previously these were scattered across the Overview and Flow tabs, cluttering the ROI-focused views
- 🔧 **Chart.js resize-on-tab-switch fix** — `switchTab()` now calls `.resize()` on all three Chart.js instances whenever the Prompt Insights tab is activated, eliminating the zero-width render bug caused by `display:none` containers

## [1.0.17] - 2026-03-14

### Fixed
- 🐛 **Inline-completion Shown/Accepted classification** — `[XtabProvider] ccreq success` lines now correctly record a **Shown** event (NES fetching and displaying a suggestion) instead of being misclassified as Accepted; only `[nes.nextCursorPosition] ccreq` lines — which fire after the user presses Tab — are counted as Accepted, making the acceptance-rate calculation accurate

### Changed
- ♻️ **Parser refactor** — `logContentParser.ts` split into three focused modules: `parsers/jsonLogParser.ts` (JSON-embedded log lines), `parsers/textLogParser.ts` (plain-text inline-completion lines), and `parsers/parserHelpers.ts` (shared accumulation utilities); the legacy `parseLegacyKeywordLine` function removed
- ♻️ **Type rename** — `LanguageStat` renamed to `UsageStatCount` throughout the codebase for clarity
- ♻️ **Webview refactor** — `webview/dashboard.ts` HTML-builder functions extracted into `webview/htmlBuilders.ts` and shared utilities moved to `webview/dashboardUtils.ts`, reducing file size and improving maintainability

## [1.0.16] - 2026-03-11

### Added
- 🏆 **Core KPI panel** — new 5-column (later 6-column) KPI grid at the top of the Overview tab surfaces **Accepted Completions**, **Acceptance Rate**, **Est. Time Saved (ROI)**, **Avg Latency**, **Active Sessions**, and **Best Model: highest acceptance** at a glance
- 🌟 **ROI gamification** — Time Saved card (and the Tree View item) displays a tier badge and colour based on cumulative minutes saved: 🏆 gold (≥ 10 h), ⭐ green (≥ 3 h), ✨ blue (≥ 1 h)
- 🤖 **Best Model KPI** — Overview KPI card now always shows the inline-completion model with the highest acceptance rate (minimum 5 suggestions shown), formatted as `model (rate%)`; no longer requires optional external metrics data
- 🌲 **Tree View KPIs** — Activity Bar sidebar renamed "Summary" → **Key Performance Indicators**; surfaces the same 5 KPIs with ROI-tier icon colours via `vscode.ThemeColor`

### Changed
- **`buildDashboardPayload`** — Best Model derivation moved from the optional `modelPerformance` argument to `stats.byModel` (always populated by the log parser); hoisted `normalizedInlineByModel` computation to avoid duplicate work; added defensive `shown === 0` guard

## [1.0.15] - 2026-03-10

### Added
- 📂 **Session Intelligence Explorer** — new **Sessions** tab in the dashboard lists every recorded VS Code session with date, total actions, True Acceptance Rate, autonomous duration, and an efficiency score; clicking a row loads the full session detail view
- 🧵 **Thread-level session drill-down** — each session can be expanded to see its individual chat threads; the detail pane shows a chronological step-by-step timeline (Prompt → Planning → Research → Execution → Memory phases) with per-step actor icons and acceptance indicators
- 🗂️ **Chat session title reader** — `chatSessionTitleReader` parses the VS Code Copilot JSONL mutation log to reconstruct human-readable chat session titles, first-request text, and custom titles; titles are surfaced in the Sessions tab and thread list
- 🔗 **Session data pipeline** — `logContentParser` now captures `ChatSessionRecord` and `ChatSessionRequest` objects; `copilotLogParser` coordinates title resolution; `dbWorker` exposes `setChatSessions`, `setChatSessionTitles`, `getSessionList`, and `getSessionDetail` RPCs consumed by the panel
- ⚡ **Real-time inline-completion tracking** — `InlineCompletionTracker` intercepts VS Code's inline-completion provider registry so shown/accepted events are recorded into the event store immediately, without waiting for a log-file re-parse
- 🔧 **Config default raised** — `copilot-insight.maxSessionDirs` default increased from 5 to 10 so more historical sessions are visible out of the box; `copilot-insight.topLanguagesCount` setting removed (no longer needed)

## [1.0.14] - 2026-03-07

### Added
- 🧠 **Context Freshness Meter** — gauge meter in the Overview tab that shows the AI context state (0–100 %) based on cumulative actions within the session; a fatigue-curve heuristic flags when a `/compact` refresh is recommended
- 📡 **Memory-management event capture** — `logContentParser` now extracts `/compact` executions and `context_limit_reached` system-log entries with timestamps, recording them as `memoryManagementEvents` for use as time-series boundaries
- 📈 **Refresh ROI analysis** — `dbWorker` implements a `getRefreshAnalysis` RPC that compares True Acceptance Rate in the 15-minute / 10-turn windows before and after each `/compact` run, quantifying the productivity benefit of context refreshes
- 🌡️ **Context Freshness scoring** — `buildDashboardPayload` computes a 0–100 % freshness score from the session's accumulated action count and applies the fatigue curve to determine whether a refresh is needed

## [1.0.13] - 2026-03-06

### Added
- 🗺️ **Model Autonomy Leverage Map** — new bubble scatter chart in the Agent Intelligence tab correlating Autonomous Ratio (X) with Autonomous Duration (Y); bubble size encodes the number of autonomous actions; the top-right "High Leverage" quadrant highlights models that are invoked autonomously most often and stay active for longer stretches
- 📈 **Autonomy Evolution Chart** — daily trend chart showing Autonomous Volume (min, bars) alongside Thinking Depth (avg steps/loop, line) on dual Y-axes; surfaces how agentic workload and complexity evolve over time
- 📅 **Per-day agentic-depth tracking** — `byDateAgenticDepth` map added to `CopilotUsageStats`; `logContentParser` accumulates daily `totalDepth` / `loopCount` so the Autonomy Evolution Chart can plot accurate day-by-day thinking-depth averages
- 💾 **Persistent stats snapshot** — `StatsSnapshotStorage` serialises `CopilotUsageStats` to `globalStoragePath/usage-stats.json`; subsequent extension activations load the cached snapshot so usage history survives VS Code restarts without re-parsing all log files

### Changed
- 🗺️ **Model ROI Efficiency Map** — replaces the previous Flow/Velocity scatter plot in the Flow tab; plots per-model Acceptance Rate (X) vs Time Saved (Y) with bubble size proportional to total accepted completions; a shaded "High Efficiency" area highlights models that are both accurate and saving the most developer time
- 🍎 **macOS log path fix** — `logFileReader` and `copilotLogParser` now correctly resolve the VS Code extension-host log directory on macOS, where the path layout differs from Linux and Windows

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