# Change Log

All notable changes to the "copilot-insight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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