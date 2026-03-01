# Change Log

All notable changes to the "copilot-insight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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