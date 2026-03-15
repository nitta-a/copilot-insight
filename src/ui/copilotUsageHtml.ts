import { mergeCountByNormalizedModel, mergeStatsByNormalizedModel } from "../log/logContentParser";
import { calculateWeeklyTrend } from "../metrics/weeklyTrend";
import type { CopilotUsageStats, UsageStatCount } from "../types";
import { calculateTimeSavedMinutes, formatMinutesSaved, getRoiBadge, getRoiTier } from "../utils";
import type { DashboardPayload } from "./dashboardMessages";

const HOUR_CELL_INACTIVE_OPACITY = 0.08;
const HOUR_CELL_BASE_OPACITY = 0.15;
const HOUR_CELL_SCALE = 0.85;
const SESSION_ID_MAX_LENGTH = 20;

/** Latency (ms) above which a warning colour is applied. */
const LATENCY_WARN_MS = 500;

export function getHtmlContent(
  stats: CopilotUsageStats,
  nonce = "",
  scriptUri = "",
  dashboardPayload?: DashboardPayload,
): string {
  const dateData = Array.from(stats.byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const allDates = Array.from(stats.byDate.keys()).sort();
  const minDate = allDates[0] ?? "";
  const maxDate = allDates[allDates.length - 1] ?? "";
  const dateRangeLabel =
    minDate && maxDate
      ? minDate === maxDate
        ? `<p class="date-range-label">${escapeHtml(minDate.replace(/-/g, "/"))}</p>`
        : `<p class="date-range-label">${escapeHtml(minDate.replace(/-/g, "/"))} – ${escapeHtml(maxDate.replace(/-/g, "/"))}</p>`
      : "";

  const dateSection = buildDateSection(dateData, stats.chatByDate);
  const modelSection = buildModelBarChart(mergeStatsByNormalizedModel(stats.byModel), "🤖 Inline Completion Model");
  const chatModelSection = buildSimpleBarChart(
    mergeCountByNormalizedModel(stats.byChatModel),
    "💬 Chat Model",
    "green",
  );
  const intentSection = buildSimpleBarChart(stats.byChatIntent, "🎯 Chat Intent (Agent/Plan/Ask)", "blue");
  const hourSection = buildHourGrid(stats.byHour, "⏰ Activity by Hour", "", "completions");
  const chatHourSection = buildHourGrid(stats.chatByHour, "💬 Chat Activity by Hour", " chat", "chat requests");
  const warningSection = buildWarningSection(stats.logFilesFound);
  const errorSection = stats.totalErrors > 0 ? buildSimpleBarChart(stats.errorsByType, "⚠️ Errors by Type", "red") : "";
  const latencyDistSection = buildLatencyDistSection(stats);
  const sessionSection = buildSessionSection(stats.bySession);
  const contextInsightsSection = buildContextInsightsSection(stats.byContextSource);
  const contextEffectivenessSection = buildContextEffectivenessSection(stats.byContextEffectiveness);
  const coreKpiPanel = buildCoreKpiPanel(stats, dashboardPayload);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:;">
  <title>GitHub Copilot Usage</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    h1 { font-size: 1.5em; margin-bottom: 4px; }
    .date-range-label { font-size: 0.85em; opacity: 0.65; margin: 0 0 16px; }
    h2 { font-size: 1.1em; margin: 24px 0 10px; }
    /* ── Core KPI grid ─────────────────────────────────────────────────── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    @media (max-width: 700px) { .kpi-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); } }
    .kpi-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 14px 12px;
      text-align: center;
      border: 1px solid transparent;
    }
    .kpi-value {
      font-size: 1.6em;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .kpi-label { font-size: 0.78em; opacity: 0.75; }
    .kpi-card .sub-text { display: block; font-size: 0.7em; opacity: 0.6; margin-top: 2px; }
    .kpi-roi-blue  { border-color: var(--vscode-charts-blue);   }
    .kpi-roi-blue  .kpi-value { color: var(--vscode-charts-blue); }
    .kpi-roi-green { border-color: var(--vscode-charts-green);  }
    .kpi-roi-green .kpi-value { color: var(--vscode-charts-green); }
    .kpi-roi-gold  { border-color: var(--vscode-charts-orange); }
    .kpi-roi-gold  .kpi-value { color: var(--vscode-charts-orange); }
    .kpi-latency-warn { border-color: var(--vscode-charts-red, #f14c4c); }
    .kpi-latency-warn .kpi-value { color: var(--vscode-charts-red, #f14c4c); }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      padding: 16px;
      text-align: center;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: var(--vscode-charts-blue);
    }
    .stat-label { font-size: 0.85em; margin-top: 4px; opacity: 0.8; }
    .legend { display: flex; gap: 16px; margin-bottom: 8px; font-size: 0.85em; }
    .dot {
      width: 12px; height: 12px; border-radius: 50%;
      display: inline-block; margin-right: 4px; vertical-align: middle;
    }
    .blue { background: var(--vscode-charts-blue); }
    .green { background: var(--vscode-charts-green); }
    .bar-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
    .bar-label { min-width: 110px; font-size: 0.85em; text-align: right; }
    .bar-group { flex: 1; }
    .bar-track {
      height: 14px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 2px;
    }
    .bar-fill { height: 100%; border-radius: 3px; }
    .bar-count { min-width: 55px; font-size: 0.8em; opacity: 0.8; }
    .no-data { opacity: 0.6; font-style: italic; }
    .period-selector { margin-bottom: 8px; font-size: 0.85em; }
    .period-selector a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .period-selector a:hover { text-decoration: underline; }
    .warning {
      margin-bottom: 16px;
      padding: 16px;
      background: var(--vscode-inputValidation-warningBackground);
      border-radius: 6px;
    }
    .hour-grid {
      display: grid;
      grid-template-columns: repeat(24, 1fr);
      gap: 4px;
      margin-bottom: 24px;
    }
    .hour-cell {
      aspect-ratio: 1;
      border-radius: 3px;
      font-size: 0.65em;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--vscode-charts-blue);
      cursor: default;
      opacity: 0.15;
    }
    .hour-cell.active { opacity: 1; }
    .hour-cell.chat { background: var(--vscode-charts-green); }
    .model-bar-label { min-width: 200px; font-size: 0.8em; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stat-detail { font-size: 0.7em; opacity: 0.7; margin-top: 2px; }
    .purple { background: var(--vscode-charts-purple, #b180d7); }
    .red { background: var(--vscode-charts-red, #f14c4c); }
    .orange { background: var(--vscode-charts-orange, #cca700); }
    .session-table { width: 100%; border-collapse: collapse; font-size: 0.85em; margin-bottom: 24px; }
    .session-table th, .session-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--vscode-editor-inactiveSelectionBackground); }
    .session-table th { opacity: 0.7; font-weight: normal; }
    .hist-row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
    .hist-label { min-width: 80px; font-size: 0.75em; text-align: right; opacity: 0.8; }
    .hist-bar { height: 12px; border-radius: 2px; }
    .hist-count { font-size: 0.7em; opacity: 0.7; min-width: 30px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 600px) { .two-col { grid-template-columns: 1fr; } }
    .trend-container { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .trend-card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px; padding: 16px; }
    .trend-card h3 { font-size: 0.95em; margin: 0 0 12px 0; opacity: 0.8; }
    .trend-stat { display: flex; justify-content: space-between; margin: 4px 0; font-size: 0.85em; }
    .trend-diff { font-weight: bold; font-size: 1.1em; margin-top: 8px; text-align: center; }
    .trend-up { color: var(--vscode-charts-green); }
    .trend-down { color: var(--vscode-charts-red, #f14c4c); }
    .trend-neutral { opacity: 0.6; }
    @media (max-width: 600px) { .trend-container { grid-template-columns: 1fr; } }
    .insights-section { margin-bottom: 24px; }
    .insight-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 3px solid var(--vscode-charts-blue);
      border-radius: 4px;
      padding: 10px 14px;
      margin: 6px 0;
      font-size: 0.9em;
    }
    .insight-card.positive { border-left-color: var(--vscode-charts-green); }
    .insight-card.negative { border-left-color: var(--vscode-charts-red, #f14c4c); }
    .insight-icon { margin-right: 6px; }
    .tag-cloud {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      padding: 14px 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .tag-cloud-item {
      display: inline-block;
      color: var(--vscode-charts-blue);
      font-weight: 600;
      line-height: 1.3;
      cursor: default;
      transition: opacity 0.15s;
    }
    .tag-cloud-item:hover { opacity: 1 !important; }
    .rate-bar-track { height: 8px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 2px; overflow: hidden; margin-bottom: 2px; }
    /* ── Dashboard interactive section ───────────────────────────────── */
    .db-highlight { border: 1px solid var(--vscode-charts-blue); }
    .db-accent { color: var(--vscode-charts-blue); }
    .db-model { font-size: 1.1em; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .db-export-btn {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      margin-right: 8px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .db-export-btn:hover { opacity: 0.85; }
    .db-rate-cell { display: flex; align-items: center; gap: 6px; }
    .db-rate-bar { height: 8px; background: var(--vscode-charts-green); border-radius: 2px; min-width: 2px; }
    .db-vol-bar { height: 8px; background: var(--vscode-charts-blue); border-radius: 2px; min-width: 2px; opacity: 0.7; }
    .db-lang-table { width: 100%; border-collapse: collapse; font-size: 0.85em; margin-bottom: 16px; }
    .db-lang-table th, .db-lang-table td { padding: 5px 8px; text-align: left; border-bottom: 1px solid var(--vscode-editor-inactiveSelectionBackground); }
    .db-lang-table th { opacity: 0.7; font-weight: normal; }
    .db-section-sep { border: none; border-top: 1px solid var(--vscode-editor-inactiveSelectionBackground); margin: 28px 0; }
    /* ── Tab bar ──────────────────────────────────────────────────────── */
    .db-tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editor-inactiveSelectionBackground)); margin-bottom: 16px; }
    .db-tab-btn {
      background: transparent;
      color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground));
      border: none;
      border-bottom: 2px solid transparent;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 0.88em;
      font-family: var(--vscode-font-family);
      opacity: 0.75;
    }
    .db-tab-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
    .db-tab-btn.active {
      color: var(--vscode-tab-activeForeground, var(--vscode-foreground));
      border-bottom-color: var(--vscode-tab-activeBorderTop, var(--vscode-charts-blue));
      opacity: 1;
      font-weight: 600;
    }
    .db-tab-pane { display: none; }
    .db-tab-pane.active { display: block; }
    .db-freshness-card {
      background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 88%, transparent), transparent);
      border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 10px;
      padding: 16px;
      margin: 0 0 20px;
    }
    .db-freshness-header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 10px; }
    .db-freshness-status { font-size: 0.85em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .db-freshness-meter { height: 14px; border-radius: 999px; overflow: hidden; background: var(--vscode-editor-inactiveSelectionBackground); margin: 10px 0 14px; }
    .db-freshness-fill { height: 100%; border-radius: 999px; }
    .db-freshness-fill.fresh { background: linear-gradient(90deg, #2aa952, #7ecb67); }
    .db-freshness-fill.aging { background: linear-gradient(90deg, #d2a51d, #f1cc45); }
    .db-freshness-fill.exhausted { background: linear-gradient(90deg, #d14b3d, #f07b58); }
    .db-freshness-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 12px; }
    .db-freshness-meta-card { background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent); border-radius: 8px; padding: 10px 12px; }
    .db-freshness-meta-label { font-size: 0.75em; opacity: 0.7; }
    .db-freshness-meta-value { font-size: 1.05em; font-weight: 700; margin-top: 4px; }
    .db-refresh-history { margin: 0 0 22px; }
    .db-refresh-note { font-size: 0.8em; opacity: 0.7; margin: 6px 0 12px; }
    .db-refresh-roi-positive { color: var(--vscode-charts-green); }
    .db-refresh-roi-negative { color: var(--vscode-charts-red, #f14c4c); }
    .db-refresh-roi-neutral { color: var(--vscode-foreground); opacity: 0.8; }
    .db-session-layout { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 18px; min-height: 520px; }
    .db-session-detail {
      background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 82%, transparent);
      border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 10px;
      overflow: hidden;
    }
    .db-session-list { display: flex; flex-direction: column; }
    .db-session-detail-header { padding: 14px 16px; border-bottom: 1px solid var(--vscode-editor-inactiveSelectionBackground); }
    .db-session-list-body { overflow: auto; max-height: 620px; }
    .db-session-row {
      width: 100%;
      background: transparent;
      border: none;
      border-left: 4px solid transparent;
      color: inherit;
      text-align: left;
      padding: 12px 14px;
      cursor: pointer;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 72%, transparent);
    }
    .db-session-row:hover { background: var(--vscode-list-hoverBackground); }
    .db-session-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .db-session-row-score { font-size: 1.15em; font-weight: 700; }
    .db-session-row-meta { margin-top: 4px; font-size: 0.78em; opacity: 0.78; display: flex; justify-content: space-between; gap: 10px; }
    .db-session-detail-body { padding: 18px 18px 22px; }
    .db-session-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 18px; }
    .db-session-summary-card { background: color-mix(in srgb, var(--vscode-editor-background) 84%, transparent); border-radius: 8px; padding: 10px 12px; }
    .db-session-summary-label { font-size: 0.75em; opacity: 0.7; }
    .db-session-summary-value { margin-top: 4px; font-size: 1.05em; font-weight: 700; }
    .db-timeline { position: relative; padding-left: 26px; display: flex; flex-direction: column; gap: 12px; }
    .db-timeline::before {
      content: "";
      position: absolute;
      left: 11px;
      top: 6px;
      bottom: 6px;
      width: 2px;
      background: color-mix(in srgb, var(--vscode-charts-blue) 30%, var(--vscode-editor-inactiveSelectionBackground));
    }
    .db-timeline-item { position: relative; padding: 0 0 0 14px; }
    .db-timeline-dot {
      position: absolute;
      left: -3px;
      top: 4px;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--vscode-charts-blue);
      border: 2px solid var(--vscode-editor-background);
    }
    .db-timeline-item.human .db-timeline-dot { background: var(--vscode-charts-green); }
    .db-timeline-item.system .db-timeline-dot { background: var(--vscode-charts-orange); }
    .db-timeline-card { background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); border-radius: 8px; padding: 10px 12px; }
    .db-timeline-item.fatigue .db-timeline-dot {
      background: var(--vscode-charts-red, #f14c4c);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 22%, transparent);
    }
    .db-timeline-item.fatigue .db-timeline-card {
      background: color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 12%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 26%, transparent);
    }
    .db-timeline-item.fatigue .db-timeline-label {
      color: var(--vscode-charts-red, #f14c4c);
    }
    .db-timeline-meta { font-size: 0.75em; opacity: 0.7; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; }
    .db-timeline-label { font-weight: 700; display: flex; gap: 8px; align-items: center; }
    .db-timeline-detail { margin-top: 4px; font-size: 0.85em; opacity: 0.84; }
    .db-fatigue-marker { margin: 0 0 14px; padding: 12px 14px; border-radius: 8px; background: color-mix(in srgb, var(--vscode-charts-orange) 18%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-charts-orange) 35%, transparent); }
    .db-fatigue-score { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 4px 8px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-charts-orange) 22%, transparent); font-size: 0.78em; font-weight: 700; }
    .db-fatigue-reason-list, .db-episode-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .db-fatigue-reason, .db-episode-badge { padding: 4px 8px; border-radius: 999px; font-size: 0.76em; line-height: 1.2; }
    .db-fatigue-reason { background: color-mix(in srgb, var(--vscode-charts-orange) 16%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-charts-orange) 28%, transparent); }
    .db-episode-badge { background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 72%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 92%, transparent); }
    .db-episode-badge.accepted { background: color-mix(in srgb, var(--vscode-charts-green) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-green) 34%, transparent); }
    .db-episode-badge.boundary { background: color-mix(in srgb, var(--vscode-charts-orange) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-orange) 34%, transparent); }
    .db-episode-badge.fatigue { background: color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 16%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 34%, transparent); }
    .db-thread-layout { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 14px; }
    .db-thread-list, .db-thread-detail { background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent); border: 1px solid var(--vscode-editor-inactiveSelectionBackground); border-radius: 8px; }
    .db-thread-row { width: 100%; background: transparent; color: inherit; border: none; border-bottom: 1px solid color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 72%, transparent); text-align: left; padding: 12px; cursor: pointer; }
    .db-thread-row:hover { background: var(--vscode-list-hoverBackground); }
    .db-thread-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .db-thread-row-title { font-weight: 700; }
    .db-thread-row-subtext { margin-top: 4px; font-size: 0.8em; opacity: 0.68; }
    .db-thread-row-meta { margin-top: 4px; display: flex; justify-content: space-between; gap: 8px; font-size: 0.78em; opacity: 0.78; }
    .db-thread-detail { padding: 14px; }
    .db-thread-detail-header-block { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .db-thread-detail-metrics { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .db-thread-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; font-size: 0.76em; background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 72%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 92%, transparent); }
    .db-thread-chip.autonomous { background: color-mix(in srgb, var(--vscode-charts-blue) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-blue) 34%, transparent); }
    .db-agent-step-timeline { position: relative; margin-top: 10px; padding-left: 22px; display: flex; flex-direction: column; gap: 12px; }
    .db-agent-step-timeline::before { content: ""; position: absolute; left: 8px; top: 4px; bottom: 4px; width: 2px; background: var(--vscode-debugConsole-border, var(--vscode-editor-inactiveSelectionBackground)); }
    .db-agent-step-row { position: relative; display: block; }
    .db-agent-step-row::before { content: ""; position: absolute; left: -18px; top: 14px; width: 10px; height: 10px; border-radius: 999px; background: var(--vscode-charts-blue); border: 2px solid var(--vscode-editor-background); }
    .db-agent-step-row.longest-pause::before { box-shadow: 0 0 0 4px color-mix(in srgb, var(--vscode-charts-orange) 26%, transparent); }
    .db-agent-step-row.significant-pause { margin-bottom: 12px; }
    .db-agent-step-badge { display: inline-flex; align-items: center; justify-content: center; min-height: 20px; padding: 4px 10px; border-radius: 999px; font-size: 0.76em; font-weight: 700; border: 1px solid transparent; }
    .db-agent-step-badge.prompt { background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 90%, transparent); border-color: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 100%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.updated { background: color-mix(in srgb, var(--vscode-charts-green) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-green) 35%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.executed { background: color-mix(in srgb, var(--vscode-charts-blue) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-blue) 35%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.searched { background: color-mix(in srgb, var(--vscode-charts-orange) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-orange) 35%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.reviewed, .db-agent-step-badge.evaluating { background: color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 18%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 35%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.considered, .db-agent-step-badge.creating { background: color-mix(in srgb, var(--vscode-charts-blue) 14%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-blue) 28%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.reference { background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 90%, transparent); border-color: var(--vscode-debugConsole-border, var(--vscode-editor-inactiveSelectionBackground)); color: var(--vscode-foreground); }
    .db-agent-step-badge.memory { background: color-mix(in srgb, var(--vscode-charts-orange) 16%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-orange) 35%, transparent); color: var(--vscode-foreground); }
    .db-agent-step-badge.thought, .db-agent-step-badge.activity { background: color-mix(in srgb, var(--vscode-charts-blue) 10%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-blue) 20%, transparent); color: var(--vscode-foreground); opacity: 0.72; }
    .db-agent-step-body { background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 88%, transparent); border-radius: 10px; padding: 10px 12px; }
    .db-agent-step-body.fallback { opacity: 0.84; }
    .db-agent-step-meta { display: flex; justify-content: flex-end; gap: 8px; font-size: 0.75em; opacity: 0.72; }
    .db-agent-step-chip-row { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .db-agent-step-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 20px; padding: 4px 10px; border-radius: 999px; font-size: 0.76em; font-weight: 700; border: 1px solid transparent; white-space: nowrap; }
    .db-agent-step-chip-actor.human { background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 72%, transparent); border-color: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 92%, transparent); }
    .db-agent-step-chip-actor.ai { background: color-mix(in srgb, var(--vscode-charts-blue) 14%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-blue) 30%, transparent); }
    .db-agent-step-chip-actor.system { background: color-mix(in srgb, var(--vscode-charts-orange) 14%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-orange) 30%, transparent); }
    .db-agent-step-chip-duration { background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 70%, transparent); border-color: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 92%, transparent); margin-left: auto; }
    .db-agent-step-chip-duration.longest { background: color-mix(in srgb, var(--vscode-charts-orange) 20%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-orange) 36%, transparent); }
    .db-agent-step-chip-duration.pending { opacity: 0.68; }
    .db-agent-step-detail { margin-top: 6px; font-size: 0.85em; white-space: pre-wrap; word-break: break-word; }
    .db-agent-step-submeta { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.74em; opacity: 0.68; }
    .db-agent-step-duration-note { margin-top: 8px; font-size: 0.72em; opacity: 0.72; }
    .db-agent-step-separator { margin-top: 10px; padding-top: 10px; border-top: 1px dashed color-mix(in srgb, var(--vscode-charts-orange) 40%, transparent); font-size: 0.74em; color: var(--vscode-descriptionForeground); }
    .db-episode-list { margin: 16px 0 0; display: flex; flex-direction: column; gap: 8px; }
    .db-episode-card { background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); border-radius: 8px; padding: 10px 12px; }
    .db-empty-panel { padding: 28px 20px; opacity: 0.7; }
    @media (max-width: 900px) { .db-session-layout, .db-thread-layout { grid-template-columns: 1fr; } .db-agent-step-chip-duration { margin-left: 0; } }
  </style>
</head>
<body>
  <h1>🤖 GitHub Copilot Usage Dashboard</h1>
  ${dateRangeLabel}
  ${warningSection}
  <section id="db-interactive">
    <div class="db-tabs" role="tablist">
      <button class="db-tab-btn active" data-tab="overview" role="tab" aria-selected="true">📊 Overview (ROI)</button>
      <button class="db-tab-btn" data-tab="health" role="tab" aria-selected="false">🔍 Health (Diagnostics)</button>
      <button class="db-tab-btn" data-tab="flow" role="tab" aria-selected="false">🌊 Flow (Velocity)</button>
      <button class="db-tab-btn" data-tab="prompt-insights" role="tab" aria-selected="false">💬 Prompt Insights</button>
      <button class="db-tab-btn" data-tab="sessions" role="tab" aria-selected="false">📂 Sessions</button>
    </div>
    <div id="db-tab-overview" class="db-tab-pane active" role="tabpanel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span></span>
        <button id="db-btn-export-md" class="db-export-btn">📄 Export Report (Markdown)</button>
      </div>
      ${coreKpiPanel}
      <div id="db-summary-cards" class="stats-grid"></div>
      <div id="db-freshness-container"></div>
      <div id="db-refresh-analysis-container"></div>
      <div id="db-insights-container"></div>
      <div id="db-weekly-trend-container"></div>
      <div id="db-agent-intelligence-container"></div>
      <div id="db-autonomy-evolution-container"></div>
    </div>

    <div id="db-tab-health" class="db-tab-pane" role="tabpanel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <h2 style="margin:0">📈 True Acceptance Rate Timeline</h2>
        <button id="db-btn-export-png-health" class="db-export-btn">🖼️ Save Chart (PNG)</button>
      </div>
      <canvas id="db-timeline-chart" style="max-height:280px"></canvas>
      ${dateSection}
      ${modelSection}
      ${chatModelSection}
      ${intentSection}
      ${latencyDistSection}
      ${errorSection}
      ${sessionSection}
    </div>

    <div id="db-tab-flow" class="db-tab-pane" role="tabpanel">
      <div id="model-autonomy-leverage-map"></div>
      ${hourSection}
      ${chatHourSection}
      ${contextInsightsSection}
      ${contextEffectivenessSection}
    </div>

    <div id="db-tab-prompt-insights" class="db-tab-pane" role="tabpanel">
      <div id="db-tag-cloud-container"></div>
      <div class="grid-container" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:16px">
        <div id="db-intent-command-donut-container"></div>
        <div id="db-prompt-length-scatter-container"></div>
      </div>
      <div id="db-turn-churn-container"></div>
    </div>

    <div id="db-tab-sessions" class="db-tab-pane" role="tabpanel">
      <div class="db-session-layout">
        <section class="db-session-list">
          <div id="db-session-list" class="db-session-list-body"></div>
        </section>
        <section class="db-session-detail">
          <div class="db-session-detail-header">
            <h2 style="margin:0">Threads</h2>
          </div>
          <div id="db-session-detail" class="db-session-detail-body"></div>
        </section>
      </div>
    </div>
  </section>
  ${buildScriptTags(nonce, scriptUri, dashboardPayload)}
</body>
</html>`;
}

/** Builds the server-rendered core KPI grid for the Overview tab. */
function buildCoreKpiPanel(stats: CopilotUsageStats, dashboardPayload?: DashboardPayload): string {
  const editorMinutesSaved = calculateTimeSavedMinutes(stats.totalAccepted, stats.autonomousDurationMs);
  const cliMinutesSaved = dashboardPayload ? dashboardPayload.summary.totalMinutesSaved.cli : 0;
  const totalMinutesSaved = editorMinutesSaved + cliMinutesSaved;
  const tier = getRoiTier(totalMinutesSaved);
  const roiBadge = getRoiBadge(tier);
  const roiColorClass = tier ? `kpi-roi-${tier}` : "";

  const timeSavedDisplay = escapeHtml(`${roiBadge}${formatMinutesSaved(totalMinutesSaved)}`);
  const editorHours = dashboardPayload
    ? (dashboardPayload.summary.totalMinutesSaved.editor / 60).toFixed(1)
    : (editorMinutesSaved / 60).toFixed(1);
  const cliHours = dashboardPayload ? (dashboardPayload.summary.totalMinutesSaved.cli / 60).toFixed(1) : "0.0";
  const roiTooltip = ` title="${escapeHtml(`Editor: ${editorHours}h / CLI: ${cliHours}h`)}"`;
  const roiSubText = `<span class="sub-text">Editor: ${escapeHtml(editorHours)}h / CLI: ${escapeHtml(cliHours)}h</span>`;
  const latencyDisplay = stats.avgLatencyMs > 0 ? escapeHtml(`${stats.avgLatencyMs.toFixed(0)}ms`) : "—";
  const latencyClass = stats.avgLatencyMs > LATENCY_WARN_MS ? "kpi-latency-warn" : "";
  const latencyTitle =
    stats.avgLatencyMs > LATENCY_WARN_MS
      ? ` title="${escapeHtml(`Latency is high (>${LATENCY_WARN_MS}ms). Copilot responses may feel slow.`)}"`
      : "";

  const totalSessions = stats.bySession.size;

  return `<div class="kpi-grid" aria-label="Key Performance Indicators">
  <div class="kpi-card">
    <div class="kpi-value">${escapeHtml(String(stats.totalAccepted))}</div>
    <div class="kpi-label">Accepted Completions</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-value">${escapeHtml(`${stats.acceptanceRate.toFixed(1)}%`)}</div>
    <div class="kpi-label">Acceptance Rate</div>
  </div>
  <div class="kpi-card ${roiColorClass}"${roiTooltip}>
    <div class="kpi-value">${timeSavedDisplay}</div>
    <div class="kpi-label">Time Saved (ROI)</div>
    ${roiSubText}
  </div>
  <div class="kpi-card ${latencyClass}"${latencyTitle}>
    <div class="kpi-value">${latencyDisplay}</div>
    <div class="kpi-label">Avg Latency${stats.avgLatencyMs > LATENCY_WARN_MS ? " ⚠️" : ""}</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-value">${escapeHtml(String(totalSessions))}</div>
    <div class="kpi-label">Active Sessions</div>
  </div>
</div>`;
}

function buildDateSection(dateData: [string, UsageStatCount][], chatByDate: Map<string, number>): string {
  if (dateData.length === 0) {
    return `<h2>📅 Daily Usage</h2>
  <p class="no-data">No date-specific data found in logs.</p>`;
  }
  return `<h2>📅 Daily Usage</h2>
  <div class="legend">
    <span><span class="dot blue"></span>Shown</span>
    <span><span class="dot green"></span>Accepted</span>
    <span><span class="dot purple"></span>Chat</span>
    <span><span class="dot orange"></span>Rate</span>
  </div>
  ${renderDateBarChart(dateData, chatByDate)}`;
}

/** Render a simple horizontal bar chart from a Map<string, number>. */
function buildSimpleBarChart(data: Map<string, number>, title: string, colorClass: string): string {
  const sorted = Array.from(data.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    return "";
  }
  const maxVal = Math.max(...sorted.map(([, v]) => v), 1);
  const bars = sorted
    .map(
      ([label, count]) => `<div class="bar-row">
  <span class="bar-label model-bar-label">${escapeHtml(label)}</span>
  <div class="bar-group">
    <div class="bar-track">
      <div class="bar-fill ${colorClass}" style="width:${(count / maxVal) * 100}%"></div>
    </div>
  </div>
  <span class="bar-count">${count}</span>
</div>`,
    )
    .join("\n");
  return `<h2>${title}</h2>\n${bars}`;
}

/** Render a 24-hour heatmap grid. */
function buildHourGrid(byHour: Map<string, number>, title: string, cssClass: string, tooltipSuffix: string): string {
  if (byHour.size === 0) {
    return "";
  }
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const maxVal = Math.max(...Array.from(byHour.values()), 1);
  const cells = hours
    .map((hour) => {
      const count = byHour.get(hour) ?? 0;
      const opacity =
        count === 0 ? HOUR_CELL_INACTIVE_OPACITY : HOUR_CELL_BASE_OPACITY + (count / maxVal) * HOUR_CELL_SCALE;
      const activeClass = count > 0 ? " active" : "";
      return `<div class="hour-cell${cssClass}${activeClass}" style="opacity:${opacity.toFixed(2)}" title="${hour}:00 — ${count} ${tooltipSuffix}">${hour}</div>`;
    })
    .join("");
  return `<h2>${title}</h2>\n<div class="hour-grid">${cells}</div>`;
}

function buildWarningSection(logFilesFound: number): string {
  if (logFilesFound > 0) {
    return "";
  }
  return `<div class="warning">
    <strong>⚠️ No Copilot log files found.</strong><br>
    Make sure GitHub Copilot is installed and has been used.
    Logs are searched in VS Code&apos;s extension host log directory.
  </div>`;
}

function renderBarChartWithRate(data: [string, UsageStatCount][]): string {
  const maxVal = Math.max(...data.map(([, v]) => v.shown), 1);
  return data
    .map(([label, { shown, accepted }]) => {
      const rate = shown > 0 ? ((accepted / shown) * 100).toFixed(1) : "0.0";
      return `<div class="bar-row">
  <span class="bar-label">${escapeHtml(label)}</span>
  <div class="bar-group">
    <div class="bar-track">
      <div class="bar-fill blue" style="width:${(shown / maxVal) * 100}%"></div>
    </div>
    <div class="bar-track">
      <div class="bar-fill green" style="width:${(accepted / maxVal) * 100}%"></div>
    </div>
  </div>
  <span class="bar-count">${shown} / ${accepted} (${rate}%)</span>
</div>`;
    })
    .join("\n");
}

function renderDateBarChart(data: [string, UsageStatCount][], chatByDate: Map<string, number>): string {
  const allValues = data.map(([, v]) => v.shown);
  const chatValues = data.map(([dateStr]) => chatByDate.get(dateStr) ?? 0);
  const maxVal = Math.max(...allValues, ...chatValues, 1);
  return data
    .map(([label, { shown, accepted }]) => {
      const chatCount = chatByDate.get(label) ?? 0;
      const formatted = formatDateLabel(label);
      const rate = shown > 0 ? ((accepted / shown) * 100).toFixed(1) : "0.0";
      const rateNum = shown > 0 ? (accepted / shown) * 100 : 0;
      return `<div class="bar-row">
  <span class="bar-label">${escapeHtml(formatted)}</span>
  <div class="bar-group">
    <div class="bar-track">
      <div class="bar-fill blue" style="width:${(shown / maxVal) * 100}%"></div>
    </div>
    <div class="bar-track">
      <div class="bar-fill green" style="width:${(accepted / maxVal) * 100}%"></div>
    </div>
    <div class="bar-track">
      <div class="bar-fill purple" style="width:${(chatCount / maxVal) * 100}%"></div>
    </div>
    <div class="rate-bar-track">
      <div class="bar-fill orange" style="width:${rateNum}%"></div>
    </div>
  </div>
  <span class="bar-count">${shown} / ${accepted} / ${chatCount} (${rate}%)</span>
</div>`;
    })
    .join("\n");
}

function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${mm}/${dd} (${dayNames[date.getDay()]})`;
  } catch {
    return dateStr;
  }
}

function buildLatencyDistSection(stats: CopilotUsageStats): string {
  const hasInline = stats.latencies.length > 0;
  const hasChat = stats.chatLatencies.length > 0;
  if (!hasInline && !hasChat) {
    return "";
  }
  let html = '<h2>⏱️ Latency Distribution</h2><div class="two-col">';
  if (hasInline) {
    html += `<div><h3 style="font-size:0.95em">Inline Completions</h3>${buildHistogram(stats.latencies, "blue")}</div>`;
  }
  if (hasChat) {
    html += `<div><h3 style="font-size:0.95em">Chat Requests</h3>${buildHistogram(stats.chatLatencies, "green")}</div>`;
  }
  html += "</div>";
  return html;
}

function buildHistogram(values: number[], colorClass: string): string {
  if (values.length === 0) {
    return '<p class="no-data">No data</p>';
  }
  const sorted = [...values].sort((a, b) => a - b);
  const buckets: [string, number][] = [
    ["0-100ms", 0],
    ["100-200ms", 0],
    ["200-500ms", 0],
    ["500ms-1s", 0],
    ["1-2s", 0],
    ["2-5s", 0],
    ["5s+", 0],
  ];
  const thresholds = [100, 200, 500, 1000, 2000, 5000];
  for (const v of sorted) {
    const bucketIndex = thresholds.findIndex((t) => v < t);
    buckets[bucketIndex === -1 ? buckets.length - 1 : bucketIndex][1]++;
  }
  const maxVal = Math.max(...buckets.map(([, c]) => c), 1);
  return buckets
    .map(
      ([label, count]) =>
        `<div class="hist-row"><span class="hist-label">${escapeHtml(label)}</span><div class="hist-bar ${colorClass}" style="width:${(count / maxVal) * 100}%;min-width:${count > 0 ? 2 : 0}px"></div><span class="hist-count">${count}</span></div>`,
    )
    .join("\n");
}

function buildSessionSection(
  bySession: Map<
    string,
    {
      sessionId: string;
      shown: number;
      accepted: number;
      chat: number;
      errors: number;
    }
  >,
): string {
  if (bySession.size === 0) {
    return "";
  }
  const sessions = Array.from(bySession.values()).sort((a, b) => b.sessionId.localeCompare(a.sessionId));
  const rows = sessions
    .map((s) => {
      const rate = s.shown > 0 ? ((s.accepted / s.shown) * 100).toFixed(1) : "—";
      const shortId =
        s.sessionId.length > SESSION_ID_MAX_LENGTH
          ? s.sessionId.substring(0, SESSION_ID_MAX_LENGTH) + "…"
          : s.sessionId;
      return `<tr><td>${escapeHtml(shortId)}</td><td>${s.shown}</td><td>${s.accepted}</td><td>${rate}${rate !== "—" ? "%" : ""}</td><td>${s.chat}</td><td>${s.errors}</td></tr>`;
    })
    .join("\n");
  return `<h2>📂 Session Breakdown</h2>
<table class="session-table">
<tr><th>Session</th><th>Shown</th><th>Accepted</th><th>Rate</th><th>Chat</th><th>Errors</th></tr>
${rows}
</table>`;
}

function buildLatencyDetailStr(stats: CopilotUsageStats): string {
  if (stats.latencies.length === 0) {
    return "";
  }
  return `P50: ${stats.latencyP50.toFixed(0)}ms · P95: ${stats.latencyP95.toFixed(0)}ms`;
}

function buildChatLatencyDetailStr(stats: CopilotUsageStats): string {
  if (stats.chatLatencies.length === 0) {
    return "";
  }
  return `P50: ${stats.chatLatencyP50.toFixed(0)}ms · P95: ${stats.chatLatencyP95.toFixed(0)}ms`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildWeeklyTrendSection(stats: CopilotUsageStats): string {
  const trend = calculateWeeklyTrend(stats.byDate, stats.chatByDate);

  if (trend.thisWeek.shown === 0 && trend.lastWeek.shown === 0) {
    return "";
  }

  const thisRateStr = trend.thisWeek.shown > 0 ? `${trend.thisWeek.rate.toFixed(1)}%` : "—";
  const lastRateStr = trend.lastWeek.shown > 0 ? `${trend.lastWeek.rate.toFixed(1)}%` : "—";

  let diffHtml = "";
  if (trend.thisWeek.shown > 0 && trend.lastWeek.shown > 0) {
    const sign = trend.rateDiff > 0 ? "+" : "";
    const cssClass = trend.rateDiff > 0 ? "trend-up" : trend.rateDiff < 0 ? "trend-down" : "trend-neutral";
    const arrow = trend.rateDiff > 0 ? "↑" : trend.rateDiff < 0 ? "↓" : "→";
    diffHtml = `<div class="trend-diff ${cssClass}">${arrow} ${sign}${trend.rateDiff.toFixed(1)}%</div>`;
  }

  return `<h2>📈 Weekly Trend</h2>
<div class="trend-container">
  <div class="trend-card">
    <h3>Last Week</h3>
    <div class="trend-stat"><span>Shown</span><span>${trend.lastWeek.shown}</span></div>
    <div class="trend-stat"><span>Accepted</span><span>${trend.lastWeek.accepted}</span></div>
    <div class="trend-stat"><span>Rate</span><span>${lastRateStr}</span></div>
    <div class="trend-stat"><span>Chat</span><span>${trend.lastWeek.chat}</span></div>
  </div>
  <div class="trend-card">
    <h3>This Week</h3>
    <div class="trend-stat"><span>Shown</span><span>${trend.thisWeek.shown}</span></div>
    <div class="trend-stat"><span>Accepted</span><span>${trend.thisWeek.accepted}</span></div>
    <div class="trend-stat"><span>Rate</span><span>${thisRateStr}</span></div>
    <div class="trend-stat"><span>Chat</span><span>${trend.thisWeek.chat}</span></div>
    ${diffHtml}
  </div>
</div>`;
}

/** Build an insights section with automatically-generated summary observations. */
function buildInsightsSection(stats: CopilotUsageStats): string {
  const insights: string[] = [];

  // 1. Weekly rate trend insight
  const trend = calculateWeeklyTrend(stats.byDate, stats.chatByDate);
  if (trend.thisWeek.shown > 0 && trend.lastWeek.shown > 0) {
    const diff = trend.rateDiff;
    if (diff > 0) {
      insights.push(
        `<div class="insight-card"><span class="insight-icon">📈</span>This week's acceptance rate is <strong>+${diff.toFixed(1)}%</strong> higher than last week (${trend.thisWeek.rate.toFixed(1)}% vs ${trend.lastWeek.rate.toFixed(1)}%).</div>`,
      );
    } else if (diff < 0) {
      insights.push(
        `<div class="insight-card"><span class="insight-icon">📉</span>This week's acceptance rate is <strong>${diff.toFixed(1)}%</strong> lower than last week (${trend.thisWeek.rate.toFixed(1)}% vs ${trend.lastWeek.rate.toFixed(1)}%).</div>`,
      );
    }
  }

  // 2. Peak hour insight
  if (stats.byHour.size > 0) {
    const peakEntry = Array.from(stats.byHour.entries()).reduce((a, b) => (b[1] > a[1] ? b : a));
    insights.push(
      `<div class="insight-card"><span class="insight-icon">⏰</span>Most active hour: <strong>${peakEntry[0]}:00</strong> with ${peakEntry[1]} completions.</div>`,
    );
  }

  // 3. Chat vs inline ratio
  if (stats.totalChat > 0 && stats.totalShown > 0) {
    const ratio = ((stats.totalChat / (stats.totalChat + stats.totalShown)) * 100).toFixed(1);
    insights.push(
      `<div class="insight-card"><span class="insight-icon">💬</span>Chat usage ratio: <strong>${ratio}%</strong> of all Copilot interactions are chat requests.</div>`,
    );
  }

  // 4. Autonomous action count
  if (stats.subagentRequests > 0) {
    insights.push(
      `<div class="insight-card"><span class="insight-icon">🤖</span>Agent performed <strong>${stats.subagentRequests}</strong> autonomous action${stats.subagentRequests === 1 ? "" : "s"} — letting you focus on higher-level work.</div>`,
    );
  }

  // 5. Agentic loop completion rate
  if (stats.subagentLoopsStarted > 0) {
    const rate = stats.completionRate.toFixed(1);
    insights.push(
      `<div class="insight-card"><span class="insight-icon">✅</span>Agentic loop completion rate: <strong>${rate}%</strong> (${stats.subagentLoops} of ${stats.subagentLoopsStarted} loop${stats.subagentLoopsStarted === 1 ? "" : "s"} completed successfully).</div>`,
    );
  }

  if (insights.length === 0) {
    return "";
  }
  return `<h2>💡 Insights</h2>\n<div class="insights-section">${insights.join("\n")}</div>`;
}

/** Build the Context Window Insights section showing which context sources Copilot used. */
function buildContextInsightsSection(byContextSource: Map<string, number>): string {
  if (byContextSource.size === 0) {
    return `<h2>🔍 Context Window Insights</h2>
<p class="no-data">No context data found. Try loading the &#39;GitHub Copilot&#39; (not Chat) output log for better detail.</p>`;
  }
  const sorted = Array.from(byContextSource.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, v]) => sum + v, 0);
  const maxVal = Math.max(...sorted.map(([, v]) => v), 1);
  const sourceColorClass = new Map<string, string>([
    ["Open Tabs", "blue"],
    ["Workspace", "green"],
    ["MCP / External Docs", "purple"],
    ["Current File", "orange"],
    ["Snippet", "orange"],
  ]);
  const bars = sorted
    .map(([source, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      const colorClass = sourceColorClass.get(source) ?? "blue";
      return `<div class="bar-row">
  <span class="bar-label model-bar-label">${escapeHtml(source)}</span>
  <div class="bar-group">
    <div class="bar-track">
      <div class="bar-fill ${colorClass}" style="width:${(count / maxVal) * 100}%"></div>
    </div>
  </div>
  <span class="bar-count">${count} (${pct}%)</span>
</div>`;
    })
    .join("\n");
  return `<h2>🔍 Context Window Insights</h2>
<p style="font-size:0.85em;opacity:0.8;margin:0 0 8px">Context sources referenced in Copilot suggestions — total: ${total}</p>
${bars}`;
}

/** Build the Context Effectiveness Dashboard: acceptance rate per context source. */
function buildContextEffectivenessSection(byContextEffectiveness: Map<string, UsageStatCount>): string {
  if (byContextEffectiveness.size === 0) {
    return "";
  }
  const sorted = Array.from(byContextEffectiveness.entries()).sort((a, b) => b[1].shown - a[1].shown);
  const maxShown = Math.max(...sorted.map(([, v]) => v.shown), 1);
  const sourceColorClass = new Map<string, string>([
    ["Open Tabs", "blue"],
    ["Workspace", "green"],
    ["MCP / External Docs", "purple"],
    ["Current File", "orange"],
    ["Snippet", "orange"],
  ]);
  const rows = sorted
    .map(([source, { shown, accepted }]) => {
      const rate = shown > 0 ? ((accepted / shown) * 100).toFixed(1) : "0.0";
      const colorClass = sourceColorClass.get(source) ?? "blue";
      return `<div class="bar-row">
  <span class="bar-label model-bar-label">${escapeHtml(source)}</span>
  <div class="bar-group">
    <div class="bar-track">
      <div class="bar-fill ${colorClass}" style="width:${(shown / maxShown) * 100}%"></div>
    </div>
    <div class="bar-track">
      <div class="bar-fill green" style="width:${(accepted / maxShown) * 100}%"></div>
    </div>
  </div>
  <span class="bar-count">${shown} / ${accepted} (${rate}%)</span>
</div>`;
    })
    .join("\n");
  return `<h2>🎯 Context Effectiveness Dashboard</h2>
<p style="font-size:0.85em;opacity:0.8;margin:0 0 8px">Acceptance rate per context source — shown / accepted (rate)</p>
<div class="legend">
  <span><span class="dot blue"></span>Shown</span>
  <span><span class="dot green"></span>Accepted</span>
</div>
${rows}`;
}

/** Render a bar chart with shown/accepted/rate for Map<string, UsageStatCount> data (model stats). */
function buildModelBarChart(data: Map<string, UsageStatCount>, title: string): string {
  const sorted = Array.from(data.entries()).sort((a, b) => b[1].shown - a[1].shown);
  if (sorted.length === 0) {
    return "";
  }
  return `<h2>${title}</h2>
  <div class="legend">
    <span><span class="dot blue"></span>Shown</span>
    <span><span class="dot green"></span>Accepted</span>
  </div>
  ${renderBarChartWithRate(sorted)}`;
}

/** Emit the nonce-protected data + script tags for the dashboard WebView. */
function buildScriptTags(nonce: string, scriptUri: string, payload?: DashboardPayload): string {
  if (!nonce || !scriptUri || !payload) {
    return "";
  }
  // Escape sequences that could break out of a <script> block:
  // - `</` → `<\/`  (prevent premature </script>)
  // - `<!--` → `<\!--`  (prevent HTML comment injection)
  const json = JSON.stringify(payload).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  return `<script nonce="${nonce}">window.__dashboardData=${json};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>`;
}
