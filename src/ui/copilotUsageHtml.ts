import * as vscode from "vscode";
import type { CopilotUsageStats, LanguageStat } from "../types";
import type { DashboardPayload } from "./dashboardMessages";
import { calculateWeeklyTrend } from "../metrics/weeklyTrend";

const HOUR_CELL_INACTIVE_OPACITY = 0.08;
const HOUR_CELL_BASE_OPACITY = 0.15;
const HOUR_CELL_SCALE = 0.85;
const SESSION_ID_MAX_LENGTH = 20;

export function getHtmlContent(
  stats: CopilotUsageStats,
  days = 14,
  nonce = "",
  scriptUri = "",
  dashboardPayload?: DashboardPayload,
): string {
  const topCount = vscode.workspace.getConfiguration("copilot-insight").get<number>("topLanguagesCount", 10);
  const languageData = Array.from(stats.byLanguage.entries())
    .sort((a, b) => b[1].shown - a[1].shown)
    .slice(0, topCount);

  const dateData = Array.from(stats.byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-days);

  const languageSection = buildLanguageSection(languageData);
  const dateSection = buildDateSection(dateData, days, stats.chatByDate);
  const modelSection = buildModelBarChart(stats.byModel, "🤖 Inline Completion Model");
  const chatModelSection = buildSimpleBarChart(stats.byChatModel, "💬 Chat Model", "green");
  const intentSection = buildSimpleBarChart(stats.byChatIntent, "🎯 Chat Intent (Agent/Plan/Ask)", "blue");
  const hourSection = buildHourGrid(stats.byHour, "⏰ Activity by Hour", "", "completions");
  const chatHourSection = buildHourGrid(stats.chatByHour, "💬 Chat Activity by Hour", " chat", "chat requests");
  const weeklyTrendSection = buildWeeklyTrendSection(stats);
  const warningSection = buildWarningSection(stats.logFilesFound);
  const errorSection = stats.totalErrors > 0 ? buildSimpleBarChart(stats.errorsByType, "⚠️ Errors by Type", "red") : "";
  const latencyDistSection = buildLatencyDistSection(stats);
  const sessionSection = buildSessionSection(stats.bySession);
  const avgLatencyStr = stats.avgLatencyMs > 0 ? `${stats.avgLatencyMs.toFixed(0)}ms` : "—";
  const chatAvgLatencyStr = stats.chatAvgLatencyMs > 0 ? `${stats.chatAvgLatencyMs.toFixed(0)}ms` : "—";
  const latencyDetailStr = buildLatencyDetailStr(stats);
  const chatLatencyDetailStr = buildChatLatencyDetailStr(stats);

  const insightsSection = buildInsightsSection(stats);
  const contextInsightsSection = buildContextInsightsSection(stats.byContextSource);

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
    h1 { font-size: 1.5em; margin-bottom: 20px; }
    h2 { font-size: 1.1em; margin: 24px 0 10px; }
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
      margin-top: 30px;
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
    .insight-icon { margin-right: 6px; }
    .rate-bar-track { height: 8px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 2px; overflow: hidden; margin-bottom: 2px; }
    /* ── Dashboard interactive section ───────────────────────────────── */
    .db-highlight { border: 1px solid var(--vscode-charts-blue); }
    .db-accent { color: var(--vscode-charts-blue); }
    .db-model { font-size: 1.1em; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .db-period-btn {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid transparent;
      color: var(--vscode-foreground);
      border-radius: 4px;
      padding: 4px 12px;
      margin-right: 6px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .db-period-btn.active { border-color: var(--vscode-charts-blue); color: var(--vscode-charts-blue); font-weight: bold; }
    .db-period-btn:hover { background: var(--vscode-list-hoverBackground); }
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
  </style>
</head>
<body>
  <h1>🤖 GitHub Copilot Usage Dashboard</h1>

  ${buildDashboardSection(dashboardPayload)}

  <hr class="db-section-sep">
  <h2 style="margin-top:0">📋 Detailed Statistics</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${stats.totalShown}</div>
      <div class="stat-label">Suggestions Shown</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalAccepted}</div>
      <div class="stat-label">Suggestions Accepted</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.acceptanceRate.toFixed(1)}%</div>
      <div class="stat-label">Acceptance Rate</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.logFilesFound}</div>
      <div class="stat-label">Log Files Parsed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalChat}</div>
      <div class="stat-label">Chat Requests</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${avgLatencyStr}</div>
      <div class="stat-label">Inline Avg Latency</div>
      <div class="stat-detail">${latencyDetailStr}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${chatAvgLatencyStr}</div>
      <div class="stat-label">Chat Avg Latency</div>
      <div class="stat-detail">${chatLatencyDetailStr}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalRejected}</div>
      <div class="stat-label">Rejected</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalErrors}</div>
      <div class="stat-label">Errors</div>
    </div>
  </div>
  ${insightsSection}
  ${contextInsightsSection}
  ${weeklyTrendSection}
  ${hourSection}
  ${chatHourSection}
  ${languageSection}
  ${dateSection}
  ${latencyDistSection}
  ${modelSection}
  ${chatModelSection}
  ${intentSection}
  ${errorSection}
  ${sessionSection}
  ${warningSection}
  ${buildScriptTags(nonce, scriptUri, dashboardPayload)}
</body>
</html>`;
}

function buildLanguageSection(languageData: [string, LanguageStat][]): string {
  if (languageData.length === 0) {
    return '<p class="no-data">No language-specific data found in logs.</p>';
  }
  return `<h2>📊 Usage by Language</h2>
  <div class="legend">
    <span><span class="dot blue"></span>Shown</span>
    <span><span class="dot green"></span>Accepted</span>
  </div>
  ${renderBarChartWithRate(languageData)}`;
}

function buildDateSection(dateData: [string, LanguageStat][], days: number, chatByDate: Map<string, number>): string {
  const periodOptions: [number, string][] = [
    [7, "7 days"],
    [14, "14 days"],
    [30, "30 days"],
  ];
  const selector = periodOptions
    .map(([numDays, label]) => {
      if (numDays === days) {
        return `<strong>${escapeHtml(label)}</strong>`;
      }
      const args = encodeURIComponent(JSON.stringify([numDays]));
      return `<a href="command:copilot-insight.changeDailyUsagePeriod?${args}">${escapeHtml(label)}</a>`;
    })
    .join(" | ");

  if (dateData.length === 0) {
    return `<h2>📅 Daily Usage</h2>
  <div class="period-selector">${selector}</div>
  <p class="no-data">No date-specific data found in logs.</p>`;
  }
  return `<h2>📅 Daily Usage</h2>
  <div class="period-selector">${selector}</div>
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

function renderBarChartWithRate(data: [string, LanguageStat][]): string {
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

function renderDateBarChart(data: [string, LanguageStat][], chatByDate: Map<string, number>): string {
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

  // 2. Best language insight
  const minShownForInsight = 5;
  const langEntries = Array.from(stats.byLanguage.entries()).filter(([, s]) => s.shown >= minShownForInsight);
  if (langEntries.length > 0) {
    const best = langEntries.reduce((a, b) => {
      const rateA = a[1].accepted / a[1].shown;
      const rateB = b[1].accepted / b[1].shown;
      return rateB > rateA ? b : a;
    });
    const bestRate = ((best[1].accepted / best[1].shown) * 100).toFixed(1);
    insights.push(
      `<div class="insight-card"><span class="insight-icon">🏆</span>Highest acceptance rate: <strong>${escapeHtml(best[0])}</strong> at ${bestRate}% (${best[1].accepted}/${best[1].shown}).</div>`,
    );
  }

  // 3. Peak hour insight
  if (stats.byHour.size > 0) {
    const peakEntry = Array.from(stats.byHour.entries()).reduce((a, b) => (b[1] > a[1] ? b : a));
    insights.push(
      `<div class="insight-card"><span class="insight-icon">⏰</span>Most active hour: <strong>${peakEntry[0]}:00</strong> with ${peakEntry[1]} completions.</div>`,
    );
  }

  // 4. Chat vs inline ratio
  if (stats.totalChat > 0 && stats.totalShown > 0) {
    const ratio = ((stats.totalChat / (stats.totalChat + stats.totalShown)) * 100).toFixed(1);
    insights.push(
      `<div class="insight-card"><span class="insight-icon">💬</span>Chat usage ratio: <strong>${ratio}%</strong> of all Copilot interactions are chat requests.</div>`,
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
    return "";
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

/** Render a bar chart with shown/accepted/rate for Map<string, LanguageStat> data (model stats). */
function buildModelBarChart(data: Map<string, LanguageStat>, title: string): string {
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

// ---------------------------------------------------------------------------
// Dashboard interactive section (Chart.js canvases + controls)
// ---------------------------------------------------------------------------

function buildDashboardSection(payload?: DashboardPayload): string {
  if (!payload) {
    return "";
  }
  return `<section id="db-interactive">
  <div id="db-summary-cards" class="stats-grid"></div>
  <div id="db-period-selector" style="margin: 10px 0 16px;"></div>

  <h2>📈 True Acceptance Rate Timeline</h2>
  <canvas id="db-timeline-chart" style="max-height:280px"></canvas>

  <div id="db-velocity-section">
    <h2>🌊 Flow &amp; Velocity Correlation</h2>
    <p class="stat-detail" style="margin:-4px 0 8px;opacity:0.7;">
      Scatter of typing speed (KPM) vs relative completion activity.
      Red dots indicate windows where Copilot completions coincided with a significant KPM drop.
    </p>
    <canvas id="db-velocity-chart" style="max-height:240px"></canvas>
  </div>

  <h2>🌐 Language Breakdown</h2>
  <div id="db-language-table"></div>

  <div style="margin:16px 0 8px">
    <button id="db-btn-export-md" class="db-export-btn">📄 Export Report (Markdown)</button>
    <button id="db-btn-export-png" class="db-export-btn">🖼️ Export Chart (PNG)</button>
  </div>
</section>`;
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
