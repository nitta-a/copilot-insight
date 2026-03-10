/**
 * Dashboard WebView frontend — runs inside VS Code's WebviewPanel.
 *
 * Responsibilities:
 * - Render two Chart.js visualisations:
 *   1. True Acceptance Rate Timeline (bar + line combo)
 * - Render React-based charts:
 *   2. Model Autonomy Leverage Map (Recharts ScatterChart)
 * - Handle export button interactions.
 * - Persist UI state (selected tab) across tab switches via
 *   `vscode.getState()` / `vscode.setState()`.
 *
 * Communication:
 * - Listens for `dashboardData` messages from the extension host.
 * - Posts `exportMarkdown` and `exportPng` messages back.
 */

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentStep, SessionDetailPayload, SessionThreadSummary } from "../src/types";
import type {
  AgentIntelligenceOverview,
  ContextFreshness,
  DashboardPayload,
  HostToWebviewMessage,
  TimelineEntry,
  WebviewToHostMessage,
  WeeklyTrendData,
} from "../src/ui/dashboardMessages";
import { AgenticEfficiencyScatterPlot } from "./charts/AgenticEfficiencyScatterPlot";
import { AutonomyEvolutionChart } from "./charts/AutonomyEvolutionChart";
import { ModelAutonomyLeverageMap } from "./charts/ModelAutonomyLeverageMap";
import { ModelDepthVelocityChart } from "./charts/ModelDepthVelocityChart";

// Register only the Chart.js components we actually use (tree-shaking).
Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  BarController,
  LineController,
  Title,
  Tooltip,
  Legend,
);

// ---------------------------------------------------------------------------
// VS Code WebView API (injected as a global by VS Code)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): { currentTab?: string } | undefined;
  setState(state: { currentTab?: string }): void;
};

interface DashboardWindow extends Window {
  __dashboardData?: DashboardPayload;
}

declare const window: DashboardWindow;

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

let timelineChart: Chart | null = null;
let currentTab = "overview";
let currentPayload: DashboardPayload | null = null;
let selectedThreadId = "";
let selectedThreadSessionId = "";
const allSessionDetails = new Map<string, SessionDetailPayload>();
const sessionLoadQueue: string[] = [];
let isBackgroundLoading = false;
let depthVelocityChartRoot: Root | null = null;
let scatterPlotRoot: Root | null = null;
let modelAutonomyMapRoot: Root | null = null;
let autonomyEvolutionRoot: Root | null = null;

/** Unmount a React root and return null, for concise cleanup. */
function unmountRoot(root: Root | null): null {
  root?.unmount();
  return null;
}

// ---------------------------------------------------------------------------
// Theme helpers — read VS Code CSS variables for chart colours
// ---------------------------------------------------------------------------

/**
 * Distinct hardcoded red used exclusively for statistical anomaly data points.
 * Using a fixed colour (rather than the theme's `--vscode-charts-red`) ensures
 * anomaly points are immediately recognisable across light, dark, and
 * high-contrast themes where the theme red may blend with other series.
 */
const ANOMALY_POINT_COLOR = "#FF4B4B";

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

interface ChartColors {
  blue: string;
  green: string;
  orange: string;
  red: string;
  purple: string;
  foreground: string;
  grid: string;
}

function getColors(): ChartColors {
  return {
    blue: getCssVar("--vscode-charts-blue") || "#0078d4",
    green: getCssVar("--vscode-charts-green") || "#16825d",
    orange: getCssVar("--vscode-charts-orange") || "#cca700",
    red: getCssVar("--vscode-charts-red") || "#f14c4c",
    purple: getCssVar("--vscode-charts-purple") || "#b180d7",
    foreground: getCssVar("--vscode-foreground") || "#cccccc",
    grid: "rgba(128,128,128,0.15)",
  };
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function renderSummaryCards(summary: DashboardPayload["summary"]): void {
  const el = document.getElementById("db-summary-cards");
  if (!el) {
    return;
  }

  const trueRateStr = summary.trueAcceptanceRate !== null ? `${summary.trueAcceptanceRate.toFixed(1)}%` : "—";
  const totalHours = (summary.estimatedMinutesSaved / 60).toFixed(1);
  const typingHours = (summary.typingMinutesSaved / 60).toFixed(1);
  const agenticHours = (summary.agenticMinutesSaved / 60).toFixed(1);
  const roiDetail =
    summary.agenticMinutesSaved > 0 ? `Typing: ${typingHours}h + AI: ${agenticHours}h` : `Typing: ${typingHours}h`;
  const bestModelStr = summary.bestModel ?? "—";

  el.innerHTML = `
    <div class="stat-card db-highlight">
      <div class="stat-value db-accent">${trueRateStr}</div>
      <div class="stat-label">True Acceptance Rate</div>
      <div class="stat-detail">vs ${summary.acceptanceRate.toFixed(1)}% raw</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-accent">${totalHours} hours</div>
      <div class="stat-label">Estimated Time Saved</div>
      <div class="stat-detail">${roiDetail}</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-model" title="${escHtml(bestModelStr)}">${escHtml(trunc(bestModelStr, 18))}</div>
      <div class="stat-label">Best Model</div>
      <div class="stat-detail">highest acceptance</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.totalShown}</div>
      <div class="stat-label">Suggestions Shown</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.totalAccepted}</div>
      <div class="stat-label">Suggestions Accepted</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.acceptanceRate.toFixed(1)}%</div>
      <div class="stat-label">Raw Acceptance Rate</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Anomaly warning banner
// ---------------------------------------------------------------------------

function renderAnomalyBanner(timeline: TimelineEntry[]): void {
  const bannerId = "db-anomaly-banner";
  let banner = document.getElementById(bannerId);

  // Find the most recent anomaly in the timeline
  const recentAnomalies = timeline.filter((e) => e.isAnomaly);
  const latestAnomaly = recentAnomalies.at(-1);

  if (!latestAnomaly) {
    if (banner) {
      banner.style.display = "none";
    }
    return;
  }

  // Insert the banner at the top of the Health tab pane if not present yet
  if (!banner) {
    banner = document.createElement("div");
    banner.id = bannerId;
    banner.style.cssText =
      "background:var(--vscode-inputValidation-warningBackground,#6c4f00);border:1px solid var(--vscode-inputValidation-warningBorder,#cca700);border-radius:4px;padding:10px 14px;margin-bottom:12px;font-size:13px;";
    const healthPane = document.getElementById("db-tab-health");
    if (healthPane) {
      healthPane.prepend(banner);
    } else {
      document.body.prepend(banner);
    }
  }

  const count = recentAnomalies.length;
  const label = count === 1 ? "anomaly" : "anomalies";
  banner.style.display = "";

  // Build the banner content via DOM APIs to avoid mixing escaping strategies.
  banner.textContent = "";
  const strong = document.createElement("strong");
  strong.textContent = `⚠️ ${count} statistical ${label} detected in the current period.`;
  const latestSpan = document.createElement("span");
  latestSpan.textContent = ` Latest: ${latestAnomaly.date} — ${latestAnomaly.anomalyReason ?? ""}`;
  banner.appendChild(strong);
  banner.appendChild(latestSpan);
}

// ---------------------------------------------------------------------------
// Timeline chart (bar + line)
// ---------------------------------------------------------------------------

function renderTimelineChart(timeline: TimelineEntry[]): void {
  const canvas = document.getElementById("db-timeline-chart") as HTMLCanvasElement | null;
  if (!canvas) {
    return;
  }

  const c = getColors();
  const labels = timeline.map((e) => fmtDate(e.date));
  const shown = timeline.map((e) => e.shown);
  const accepted = timeline.map((e) => e.accepted);
  const rates = timeline.map((e) => e.rate);
  const trueRates = timeline.map((e) =>
    e.trueAccepted !== null ? (e.trueAccepted / Math.max(e.shown, 1)) * 100 : null,
  );
  const hasTrueRates = trueRates.some((r) => r !== null);

  // Per-point styling for anomaly detection.
  // Anomaly points use ANOMALY_COLOR (#FF4B4B) — a hardcoded bright red that
  // stands out across light, dark, and high-contrast themes — rather than the
  // theme's generic red.  A larger radius and explicit border further
  // emphasise the anomalous day.
  const pointColors = timeline.map((e) => (e.isAnomaly ? ANOMALY_POINT_COLOR : c.orange));
  const pointBorderColors = timeline.map((e) => (e.isAnomaly ? ANOMALY_POINT_COLOR : c.orange));
  const pointBorderWidths = timeline.map((e) => (e.isAnomaly ? 2 : 1));
  const pointRadii = timeline.map((e) => (e.isAnomaly ? 8 : 3));

  if (timelineChart) {
    timelineChart.destroy();
  }

  const extraDatasets = hasTrueRates
    ? [
        {
          type: "line" as const,
          label: "True Acceptance Rate (%)",
          data: trueRates as (number | null)[],
          borderColor: c.purple,
          backgroundColor: "transparent",
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yRate",
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          borderDash: [5, 5],
          order: 1,
        },
      ]
    : [];

  timelineChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Shown",
          data: shown,
          backgroundColor: `${c.blue}80`,
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yCount",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Accepted",
          data: accepted,
          backgroundColor: `${c.green}80`,
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yCount",
          order: 2,
        },
        {
          type: "line" as const,
          label: "Acceptance Rate (%)",
          data: rates,
          borderColor: c.orange,
          backgroundColor: "transparent",
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yRate",
          borderWidth: 2,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: pointBorderWidths,
          pointRadius: pointRadii,
          tension: 0.3,
          order: 1,
        },
        ...extraDatasets,
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: c.foreground } },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"bar" | "line">) => {
              const val = item.raw as number | null;
              if (val === null) {
                return "";
              }
              const isRate = item.dataset.label?.includes("Rate") ?? false;
              const base = `${item.dataset.label}: ${val.toFixed(isRate ? 1 : 0)}${isRate ? "%" : ""}`;
              // Append anomaly reason when hovering the acceptance rate line
              if (item.dataset.label === "Acceptance Rate (%)") {
                const entry = timeline[item.dataIndex];
                if (entry?.isAnomaly && entry.anomalyReason) {
                  return [base, `⚠️ ${entry.anomalyReason}`];
                }
              }
              return base;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: c.foreground }, grid: { color: c.grid } },
        yCount: {
          type: "linear" as const,
          position: "left" as const,
          beginAtZero: true,
          ticks: { color: c.foreground },
          grid: { color: c.grid },
          title: { display: true, text: "Count", color: c.foreground },
        },
        yRate: {
          type: "linear" as const,
          position: "right" as const,
          beginAtZero: true,
          max: 100,
          ticks: { color: c.foreground, callback: (v) => `${v}%` },
          grid: { display: false },
          title: { display: true, text: "Rate (%)", color: c.foreground },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Model Autonomy Leverage Map
// ---------------------------------------------------------------------------

function renderModelAutonomyLeverageMap(agenticStats: DashboardPayload["agenticStats"]): void {
  const el = document.getElementById("model-autonomy-leverage-map");
  if (!el) {
    return;
  }
  const modelData = agenticStats.agentIntelligenceOverview.autonomousRatioByModel;
  if (modelData.length === 0) {
    modelAutonomyMapRoot = unmountRoot(modelAutonomyMapRoot);
    el.innerHTML = "";
    return;
  }
  modelAutonomyMapRoot = unmountRoot(modelAutonomyMapRoot);
  modelAutonomyMapRoot = createRoot(el);
  modelAutonomyMapRoot.render(createElement(ModelAutonomyLeverageMap, { data: modelData }));
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function renderInsights(insights: string[]): void {
  const el = document.getElementById("db-insights-container");
  if (!el) {
    return;
  }
  if (insights.length === 0) {
    el.innerHTML = "";
    return;
  }
  const cards = insights
    .map((text) => {
      const cls = getInsightClass(text);
      return `<div class="insight-card${cls}"><span class="insight-icon"></span>${escHtml(text)}</div>`;
    })
    .join("\n");
  el.innerHTML = `<h2>💡 Insights</h2>\n<div class="insights-section">${cards}</div>`;
}

function renderContextFreshness(
  freshness: ContextFreshness | null,
  refreshAnalysis: DashboardPayload["refreshAnalysis"],
): void {
  const el = document.getElementById("db-freshness-container");
  if (!el) {
    return;
  }
  if (!freshness || refreshAnalysis.length === 0) {
    el.innerHTML = "";
    return;
  }

  const latestRefresh = refreshAnalysis.at(-1) ?? null;
  const score = Math.max(0, Math.min(100, freshness.score));
  const statusLabel = freshness.status === "fresh" ? "Fresh" : freshness.status === "aging" ? "Aging" : "Exhausted";
  const statusDetail =
    freshness.status === "fresh"
      ? "AI は絶好調"
      : freshness.status === "aging"
        ? "/compact を検討してください"
        : "セッションの再起動を推奨";
  const suggestion =
    freshness.suggestedAction === "none"
      ? "今はリフレッシュ不要です。"
      : freshness.suggestedAction === "compact"
        ? "次の大きなタスク前に /compact を挟むのが妥当です。"
        : "新しいセッションを開始した方が回復しやすい状態です。";
  const latestRoi = freshness.latestRefreshRoi !== null ? `+${(freshness.latestRefreshRoi * 100).toFixed(1)}%` : "N/A";
  const latestRecovery =
    freshness.latestRecoveryDelta !== null ? `${freshness.latestRecoveryDelta.toFixed(1)} pt` : "N/A";
  const latestEventType = latestRefresh ? latestRefresh.event.type : "memory";
  const latestTimestamp = latestRefresh ? new Date(latestRefresh.event.timestamp).toLocaleString() : "";

  el.innerHTML = `
    <h2>🧠 Context Freshness</h2>
    <div class="db-freshness-card">
      <div class="db-freshness-header">
        <div>
          <div class="db-freshness-status">${escHtml(statusLabel)}</div>
          <div style="font-size:1.6em;font-weight:800;margin-top:2px">${score.toFixed(0)}%</div>
        </div>
        <div style="font-size:0.88em;opacity:0.8;text-align:right">${escHtml(statusDetail)}</div>
      </div>
      <div class="db-freshness-meter">
        <div class="db-freshness-fill ${freshness.status}" style="width:${score}%"></div>
      </div>
      <div style="font-size:0.88em;opacity:0.84">${escHtml(suggestion)}</div>
      <div class="db-freshness-meta">
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Current Session Actions</div>
          <div class="db-freshness-meta-value">${freshness.actionCount}</div>
        </div>
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Latest Refresh ROI</div>
          <div class="db-freshness-meta-value">${escHtml(latestRoi)}</div>
        </div>
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Recovery Delta</div>
          <div class="db-freshness-meta-value">${escHtml(latestRecovery)}</div>
        </div>
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Latest Boundary</div>
          <div class="db-freshness-meta-value" title="${escHtml(latestTimestamp)}">${escHtml(trunc(latestEventType, 22))}</div>
        </div>
      </div>
    </div>`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  const signed = value >= 0 ? "+" : "";
  return `${signed}${(value * 100).toFixed(1)}%`;
}

function formatSignedPoints(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  const signed = value >= 0 ? "+" : "";
  return `${signed}${value.toFixed(1)} pt`;
}

function getDeltaClass(value: number | null): string {
  if (value === null) {
    return "db-refresh-roi-neutral";
  }
  if (value > 0) {
    return "db-refresh-roi-positive";
  }
  if (value < 0) {
    return "db-refresh-roi-negative";
  }
  return "db-refresh-roi-neutral";
}

function renderRefreshAnalysis(refreshAnalysis: DashboardPayload["refreshAnalysis"]): void {
  const el = document.getElementById("db-refresh-analysis-container");
  if (!el) {
    return;
  }
  if (refreshAnalysis.length === 0) {
    el.innerHTML = "";
    return;
  }

  const roiValues = refreshAnalysis.map((entry) => entry.refreshRoi).filter((value): value is number => value !== null);
  const avgRoi = roiValues.length > 0 ? roiValues.reduce((sum, value) => sum + value, 0) / roiValues.length : null;
  const avgRecoveryDelta =
    refreshAnalysis.reduce((sum, entry) => sum + entry.recoveryDelta, 0) / refreshAnalysis.length;
  const bestEntry =
    [...refreshAnalysis].sort((a, b) => (b.refreshRoi ?? -Infinity) - (a.refreshRoi ?? -Infinity))[0] ?? null;
  const latestEntry = refreshAnalysis.at(-1) ?? null;

  const rows = [...refreshAnalysis]
    .sort((a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime())
    .map((entry) => {
      const timestamp = new Date(entry.event.timestamp).toLocaleString();
      const recoveryClass = getDeltaClass(entry.recoveryDelta);
      const roiClass = getDeltaClass(entry.refreshRoi);
      return `<tr>
        <td>${escHtml(timestamp)}</td>
        <td>${escHtml(entry.event.type)}</td>
        <td>${entry.preTurns.trueRate.toFixed(1)}%</td>
        <td>${entry.postTurns.trueRate.toFixed(1)}%</td>
        <td class="${recoveryClass}">${escHtml(formatSignedPoints(entry.recoveryDelta))}</td>
        <td class="${roiClass}">${escHtml(formatSignedPercent(entry.refreshRoi))}</td>
      </tr>`;
    })
    .join("");

  el.innerHTML = `
    <div class="db-refresh-history">
      <h2>🔄 Refresh ROI</h2>
      <div class="stats-grid">
        <div class="stat-card db-highlight">
          <div class="stat-value db-accent">${refreshAnalysis.length}</div>
          <div class="stat-label">Refresh Events</div>
          <div class="stat-detail">compact or truncation boundaries</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${getDeltaClass(avgRoi)}">${escHtml(formatSignedPercent(avgRoi))}</div>
          <div class="stat-label">Average ROI</div>
          <div class="stat-detail">post.trueRate / pre.trueRate - 1</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${getDeltaClass(avgRecoveryDelta)}">${escHtml(formatSignedPoints(avgRecoveryDelta))}</div>
          <div class="stat-label">Average Recovery</div>
          <div class="stat-detail">post true rate minus pre true rate</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${getDeltaClass(bestEntry?.refreshRoi ?? null)}">${escHtml(formatSignedPercent(bestEntry?.refreshRoi ?? null))}</div>
          <div class="stat-label">Best Refresh</div>
          <div class="stat-detail">${escHtml(bestEntry?.event.type ?? latestEntry?.event.type ?? "memory")}</div>
        </div>
      </div>
      <div class="db-refresh-note">Compares the last 10 turns before and after each refresh boundary. Older VS Code logs without compact or truncation signals are hidden automatically.</div>
      <table class="db-lang-table">
        <tr><th>Time</th><th>Event</th><th>Pre True Rate</th><th>Post True Rate</th><th>Recovery Delta</th><th>Refresh ROI</th></tr>
        ${rows}
      </table>
    </div>`;
}

function getInsightClass(text: string): string {
  if (/📈/.test(text)) {
    return " positive";
  }
  if (/📉/.test(text)) {
    return " negative";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Weekly trend
// ---------------------------------------------------------------------------

function renderWeeklyTrend(trend: WeeklyTrendData | null): void {
  const el = document.getElementById("db-weekly-trend-container");
  if (!el) {
    return;
  }
  if (!trend || (trend.thisWeek.shown === 0 && trend.lastWeek.shown === 0)) {
    el.innerHTML = "";
    return;
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

  el.innerHTML = `<h2>📈 Weekly Trend</h2>
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

// ---------------------------------------------------------------------------
// Export buttons
// ---------------------------------------------------------------------------

const EXPORT_BUTTON_LABELS: Record<string, string> = {
  "db-btn-export-md": "📄 Export Report (Markdown)",
  "db-btn-export-png-health": "🖼️ Save Chart (PNG)",
};

function setExportLoading(btnId: string, loading: boolean): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  if (!btn) {
    return;
  }
  btn.disabled = loading;
  btn.textContent = loading ? "⏳ Exporting…" : (EXPORT_BUTTON_LABELS[btnId] ?? btn.textContent);
}

function exportChartAsPng(canvasId: string, chartId: "timeline" | "velocity" | "overview"): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  const imageData = canvas?.toDataURL("image/png") ?? "";
  vscode.postMessage({ type: "exportPng", payload: { imageData, chartId } } satisfies WebviewToHostMessage);
}

function setupExportButtons(): void {
  document.getElementById("db-btn-export-md")?.addEventListener("click", () => {
    setExportLoading("db-btn-export-md", true);
    vscode.postMessage({ type: "exportMarkdown" } satisfies WebviewToHostMessage);
  });

  document.getElementById("db-btn-export-png-health")?.addEventListener("click", () => {
    setExportLoading("db-btn-export-png-health", true);
    exportChartAsPng("db-timeline-chart", "timeline");
  });
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

const VALID_TABS = new Set(["overview", "health", "flow", "sessions"]);

function switchTab(tabId: string): void {
  currentTab = tabId;
  vscode.setState({ currentTab: tabId });

  document.querySelectorAll<HTMLButtonElement>(".db-tab-btn").forEach((btn) => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll<HTMLElement>(".db-tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `db-tab-${tabId}`);
  });

  // Trigger resize so Chart.js renders correctly after becoming visible.
  if (tabId === "health" && timelineChart) {
    timelineChart.resize();
  }
}

function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".db-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab ?? "";
      if (VALID_TABS.has(tabId)) {
        switchTab(tabId);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Agent Intelligence Overview
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function renderAgentIntelligenceOverview(agenticStats: DashboardPayload["agenticStats"]): void {
  const el = document.getElementById("db-agent-intelligence-container");
  if (!el) {
    return;
  }

  const featureCards = [
    {
      label: "Browser Tools",
      total: agenticStats.featureSignals.browserTools.total,
      detail: agenticStats.featureSignals.browserTools.breakdown,
    },
    {
      label: "Plugins / Skills",
      total: agenticStats.featureSignals.pluginOrSkills.total,
      detail: agenticStats.featureSignals.pluginOrSkills.breakdown,
    },
    {
      label: "Session Memory / Compact",
      total: agenticStats.featureSignals.memoryManagement.total,
      detail: agenticStats.featureSignals.memoryManagement.breakdown,
    },
    {
      label: "Agent Debug",
      total: agenticStats.featureSignals.agentDebug.total,
      detail: agenticStats.featureSignals.agentDebug.breakdown,
    },
  ];
  const hasFeatureSignals = featureCards.some((card) => card.total > 0);

  if (agenticStats.subagentRequests === 0 && !hasFeatureSignals) {
    depthVelocityChartRoot = unmountRoot(depthVelocityChartRoot);
    scatterPlotRoot = unmountRoot(scatterPlotRoot);
    el.innerHTML = '<p class="no-data">No autonomous activity or 1.110 feature signals detected in this period.</p>';
    return;
  }

  const overview: AgentIntelligenceOverview = agenticStats.agentIntelligenceOverview;
  const ratioStr = agenticStats.agenticRatio.toFixed(1);
  const avgStr = overview.avgCallsPerLoop > 0 ? overview.avgCallsPerLoop.toFixed(1) : "—";
  const completionStr = overview.completionRate > 0 ? `${overview.completionRate.toFixed(1)}%` : "—";
  const durationCell =
    agenticStats.autonomousDurationMs > 0
      ? `<div class="stat-card"><div class="stat-value">${escHtml(formatDuration(agenticStats.autonomousDurationMs))}</div><div class="stat-label">Autonomous Duration</div><div class="stat-detail">total active time</div></div>`
      : "";

  // Planning & Execution stats
  const planSuccessStr = overview.planCount > 0 ? `${overview.planSuccessRate.toFixed(1)}%` : "—";
  const planningSection =
    overview.planCount > 0
      ? `<hr class="db-section-sep">
       <h3 style="font-size:1em;margin:16px 0 10px">📋 Planning &amp; Execution</h3>
       <div class="stats-grid">
         <div class="stat-card">
           <div class="stat-value">${overview.planCount}</div>
           <div class="stat-label">Plans Proposed</div>
           <div class="stat-detail">agent/plan proposals</div>
         </div>
         <div class="stat-card">
           <div class="stat-value">${overview.executedPlanCount}</div>
           <div class="stat-label">Plans Executed</div>
           <div class="stat-detail">led to file edits</div>
         </div>
         <div class="stat-card db-highlight">
           <div class="stat-value db-accent">${planSuccessStr}</div>
           <div class="stat-label">Success Rate</div>
           <div class="stat-detail">plans implemented</div>
         </div>
         <div class="stat-card">
           <div class="stat-value">${overview.userChoicesInPlan}</div>
           <div class="stat-label">User Choices</div>
           <div class="stat-detail">in-plan interactions</div>
         </div>
       </div>`
      : "";

  const modelRows = overview.autonomousRatioByModel
    .map(({ model, subagentCount, totalCount, ratio, velocitySecondsPerAction }) => {
      const velocityStr = velocitySecondsPerAction > 0 ? `${velocitySecondsPerAction.toFixed(1)}s` : "—";
      return `<tr>
          <td>${escHtml(trunc(model, 30))}</td>
          <td>${subagentCount} / ${totalCount}</td>
          <td>${ratio.toFixed(1)}%</td>
          <td>${velocityStr}</td>
        </tr>`;
    })
    .join("");

  const modelTable = modelRows
    ? `<h3 style="font-size:0.9em;margin:16px 0 6px;opacity:0.8">Autonomous Ratio by Model</h3>
       <table class="db-lang-table">
         <tr><th>Model</th><th>Autonomous / Total</th><th>Ratio</th><th>Avg sec / Action</th></tr>
         ${modelRows}
       </table>`
    : "";

  const featureSection = hasFeatureSignals
    ? `<hr class="db-section-sep">
       <h3 style="font-size:1em;margin:16px 0 10px">🧪 VS Code 1.110 Feature Signals</h3>
       <div class="stats-grid">
         ${featureCards
           .map((card) => {
             const top = card.detail
               .slice(0, 2)
               .map((entry) => `${escHtml(entry.name)} (${entry.count})`)
               .join(" · ");
             return `<div class="stat-card">
               <div class="stat-value">${card.total}</div>
               <div class="stat-label">${escHtml(card.label)}</div>
               <div class="stat-detail">${top || "detected log signals"}</div>
             </div>`;
           })
           .join("")}
       </div>`
    : "";

  el.innerHTML = `
    <hr class="db-section-sep">
    <h2>🤖 Agent Intelligence Overview</h2>
    <div class="stats-grid">
      <div class="stat-card db-highlight">
        <div class="stat-value db-accent">${overview.autonomousActionCount}</div>
        <div class="stat-label">Autonomous Actions</div>
        <div class="stat-detail">All agentic activity</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${ratioStr}%</div>
        <div class="stat-label">Agentic Ratio</div>
        <div class="stat-detail">of all requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${overview.agenticLoopCount}</div>
        <div class="stat-label">Agentic Loops</div>
        <div class="stat-detail">completed episodes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgStr}</div>
        <div class="stat-label">Avg Calls / Loop</div>
        <div class="stat-detail">agentic depth</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${completionStr}</div>
        <div class="stat-label">Completion Rate</div>
        <div class="stat-detail">episodes completed</div>
      </div>
      ${durationCell}
    </div>
    ${modelTable}
    ${featureSection}
    ${planningSection}
    <div id="db-model-depth-chart" style="margin-top:16px"></div>
    <div id="db-agentic-scatter" style="margin-top:4px"></div>`;

  // Mount React chart components into the containers just added.
  const modelData = overview.autonomousRatioByModel;

  const depthEl = document.getElementById("db-model-depth-chart");
  if (depthEl && modelData.length > 0) {
    depthVelocityChartRoot = unmountRoot(depthVelocityChartRoot);
    depthVelocityChartRoot = createRoot(depthEl);
    depthVelocityChartRoot.render(createElement(ModelDepthVelocityChart, { data: modelData }));
  } else {
    depthVelocityChartRoot = unmountRoot(depthVelocityChartRoot);
  }

  const scatterEl = document.getElementById("db-agentic-scatter");
  if (scatterEl && modelData.length > 0) {
    scatterPlotRoot = unmountRoot(scatterPlotRoot);
    scatterPlotRoot = createRoot(scatterEl);
    scatterPlotRoot.render(createElement(AgenticEfficiencyScatterPlot, { data: modelData }));
  } else {
    scatterPlotRoot = unmountRoot(scatterPlotRoot);
  }
}

function renderAutonomyEvolution(evolutionData: DashboardPayload["evolutionData"]): void {
  const el = document.getElementById("db-autonomy-evolution-container");
  if (!el) {
    return;
  }

  if (evolutionData.length === 0) {
    autonomyEvolutionRoot = unmountRoot(autonomyEvolutionRoot);
    el.innerHTML = '<p class="no-data">No autonomy evolution data available for this period.</p>';
    return;
  }

  el.innerHTML = `
    <hr class="db-section-sep">
    <h2>🧭 Autonomy Evolution</h2>
    <div id="db-autonomy-evolution-chart" style="margin-top:16px"></div>`;

  const chartEl = document.getElementById("db-autonomy-evolution-chart");
  if (!chartEl) {
    return;
  }

  autonomyEvolutionRoot = unmountRoot(autonomyEvolutionRoot);
  autonomyEvolutionRoot = createRoot(chartEl);
  autonomyEvolutionRoot.render(createElement(AutonomyEvolutionChart, { data: evolutionData }));
}

function formatPhaseLabel(phase: string): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function formatPause(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatStepDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (detail === null || detail === undefined) {
    return fallback;
  }
  if (typeof detail === "object") {
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return fallback;
    }
  }
  return String(detail);
}

function agentStepBadgeClass(label: AgentStep["label"]): string {
  switch (label) {
    case "Prompt":
      return "prompt";
    case "Updated":
      return "updated";
    case "Executed":
      return "executed";
    case "Searched":
      return "searched";
    case "Reviewed":
      return "reviewed";
    case "Evaluating":
      return "evaluating";
    case "Considered":
      return "considered";
    case "Creating":
      return "creating";
    case "Used reference":
      return "reference";
    case "Memory file":
      return "memory";
    case "Thought":
      return "thought";
    case "Activity":
      return "activity";
  }
}

function actorBadgeClass(actor: AgentStep["actor"]): string {
  switch (actor) {
    case "human":
      return "human";
    case "ai":
      return "ai";
    case "system":
      return "system";
  }
}

function actorLabel(actor: AgentStep["actor"]): string {
  switch (actor) {
    case "human":
      return "Human";
    case "ai":
      return "AI";
    case "system":
      return "System";
  }
}

function actorIcon(actor: AgentStep["actor"]): string {
  switch (actor) {
    case "human":
      return "👤";
    case "ai":
      return "🤖";
    case "system":
      return "⚙";
  }
}

function sortThreadsNewestFirst(threads: SessionDetailPayload["threads"]): SessionDetailPayload["threads"] {
  return [...threads].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

function filterSelectableThreads(threads: SessionDetailPayload["threads"]): SessionDetailPayload["threads"] {
  return threads.filter((thread) => thread.stepCount > 0);
}

function requestSessionDetail(sessionId: string): void {
  vscode.postMessage({ type: "requestSessionDetail", payload: { sessionId } } satisfies WebviewToHostMessage);
}

function loadNextFromQueue(): void {
  if (isBackgroundLoading) {
    return;
  }
  while (sessionLoadQueue.length > 0) {
    const sessionId = sessionLoadQueue.shift()!;
    if (!allSessionDetails.has(sessionId)) {
      isBackgroundLoading = true;
      requestSessionDetail(sessionId);
      return;
    }
  }
}

function renderSelectedThread(detail: SessionDetailPayload): string {
  const sortedThreads = sortThreadsNewestFirst(filterSelectableThreads(detail.threads));
  const selectedThread =
    sortedThreads.find((thread) => thread.threadId === selectedThreadId) ?? sortedThreads[0] ?? null;
  if (!selectedThread) {
    return '<div class="db-empty-panel">No thread detail with activity is available.</div>';
  }
  if (selectedThreadId !== selectedThread.threadId) {
    selectedThreadId = selectedThread.threadId;
  }
  const steps = detail.stepsByThread[selectedThread.threadId] ?? [];
  const longestPause = steps.reduce((max, step) => Math.max(max, step.durationMs ?? 0), 0);
  const stepsHtml =
    steps.length > 0
      ? steps
          .map((step) => {
            const pause = step.durationMs ?? 0;
            const isLongest = pause > 0 && pause === longestPause;
            const durationChip =
              step.durationMs !== undefined
                ? `<span class="db-agent-step-chip db-agent-step-chip-duration${isLongest ? " longest" : ""}">⏱ ${escHtml(formatPause(step.durationMs))}</span>`
                : '<span class="db-agent-step-chip db-agent-step-chip-duration pending">Current</span>';
            const pauseHtml =
              step.isSignificantPause && step.durationMs !== undefined
                ? '<div class="db-agent-step-separator">(Significant Pause)</div>'
                : "";
            return `<div class="db-agent-step-row${isLongest ? " longest-pause" : ""}${step.isSignificantPause ? " significant-pause" : ""}">
              <div class="db-agent-step-body${step.isFallback ? " fallback" : ""}">
                <div class="db-agent-step-meta">
                  <span>${escHtml(new Date(step.timestamp).toLocaleString())}</span>
                </div>
                <div class="db-agent-step-chip-row">
                  <span class="db-agent-step-chip db-agent-step-chip-actor ${actorBadgeClass(step.actor)}"><span>${actorIcon(step.actor)}</span><span>${escHtml(actorLabel(step.actor))}</span></span>
                  <span class="db-agent-step-badge ${agentStepBadgeClass(step.label)}">${escHtml(step.label)}</span>
                  ${durationChip}
                </div>
                <div class="db-agent-step-detail">${escHtml(formatStepDetail(step.detail, step.label))}</div>
                <div class="db-agent-step-submeta"><span>${escHtml(formatPhaseLabel(step.phase))}</span><span>${escHtml(step.rawIntent || "signal")}</span></div>
                ${isLongest ? '<div class="db-agent-step-duration-note">Longest wait</div>' : ""}
                ${pauseHtml}
              </div>
            </div>`;
          })
          .join("\n")
      : '<div class="db-empty-panel">No timeline signals were recorded for this thread.</div>';
  return `<div class="db-thread-detail-header-block">
      <div><strong>${escHtml(selectedThread.title)}</strong><div style="margin-top:4px;font-size:0.84em;opacity:0.74">${escHtml(new Date(selectedThread.startedAt).toLocaleString())}</div></div>
      <div class="db-thread-detail-metrics">
        <span class="db-thread-chip">${selectedThread.stepCount} steps</span>
        <span class="db-thread-chip">${selectedThread.estimatedMinutesSaved.toFixed(1)} min saved</span>
        ${selectedThread.longestPauseMs > 0 ? `<span class="db-thread-chip">Longest wait ${escHtml(formatPause(selectedThread.longestPauseMs))}</span>` : ""}
        ${selectedThread.hasAutonomousRun ? '<span class="db-thread-chip autonomous">🤖 Autonomous</span>' : ""}
      </div>
    </div>
    <div class="db-agent-step-timeline">${stepsHtml}</div>`;
}

function renderAllThreads(): void {
  const el = document.getElementById("db-session-list");
  if (!el) {
    return;
  }
  const flat: Array<{ thread: SessionThreadSummary; sessionId: string }> = [];
  for (const [sessionId, detail] of allSessionDetails) {
    for (const thread of filterSelectableThreads(detail.threads)) {
      flat.push({ thread, sessionId });
    }
  }
  if (flat.length === 0) {
    el.innerHTML = `<div class="db-empty-panel">${isBackgroundLoading || sessionLoadQueue.length > 0 ? "Loading threads\u2026" : "No threads with activity were detected."}</div>`;
    return;
  }
  flat.sort((a, b) => Date.parse(b.thread.startedAt) - Date.parse(a.thread.startedAt));
  el.innerHTML = flat
    .map(({ thread, sessionId }) => {
      const active = thread.threadId === selectedThreadId && sessionId === selectedThreadSessionId ? " active" : "";
      return `<button class="db-thread-row${active}" data-thread-id="${escHtml(thread.threadId)}" data-session-id="${escHtml(sessionId)}">
        <div class="db-thread-row-title">${thread.hasAutonomousRun ? "\uD83E\uDD16 " : ""}${escHtml(thread.title)}</div>
        <div class="db-thread-row-subtext">${escHtml(new Date(thread.startedAt).toLocaleString())}</div>
        <div class="db-thread-row-meta"><span>${thread.stepCount} steps</span><span>${thread.estimatedMinutesSaved.toFixed(1)} min saved</span></div>
      </button>`;
    })
    .join("");
  el.querySelectorAll<HTMLButtonElement>(".db-thread-row").forEach((button) => {
    button.addEventListener("click", () => {
      const threadId = button.dataset.threadId ?? "";
      const sessionId = button.dataset.sessionId ?? "";
      if (threadId && !(threadId === selectedThreadId && sessionId === selectedThreadSessionId)) {
        selectedThreadId = threadId;
        selectedThreadSessionId = sessionId;
        renderAllThreads();
        renderThreadDetail();
      }
    });
  });
}

function renderThreadDetail(): void {
  const el = document.getElementById("db-session-detail");
  if (!el) {
    return;
  }
  if (!selectedThreadId || !selectedThreadSessionId) {
    el.innerHTML = '<div class="db-empty-panel">Select a thread to inspect its timeline.</div>';
    return;
  }
  const detail = allSessionDetails.get(selectedThreadSessionId);
  if (!detail) {
    el.innerHTML = '<div class="db-empty-panel">Loading thread detail…</div>';
    return;
  }
  el.innerHTML = renderSelectedThread(detail);
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

function render(payload: DashboardPayload): void {
  currentPayload = payload;
  renderAnomalyBanner(payload.timeline);
  renderSummaryCards(payload.summary);
  renderContextFreshness(payload.freshness, payload.refreshAnalysis);
  renderRefreshAnalysis(payload.refreshAnalysis);
  renderInsights(payload.insights);
  renderWeeklyTrend(payload.weeklyTrend);
  renderAgentIntelligenceOverview(payload.agenticStats);
  renderAutonomyEvolution(payload.evolutionData);
  renderTimelineChart(payload.timeline);
  renderModelAutonomyLeverageMap(payload.agenticStats);
  for (const session of payload.sessionSummaries) {
    if (!allSessionDetails.has(session.sessionId)) {
      sessionLoadQueue.push(session.sessionId);
    }
  }
  loadNextFromQueue();
  renderAllThreads();
  renderThreadDetail();
}

// ---------------------------------------------------------------------------
// Message handler (host → webview updates)
// ---------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
  const msg = event.data;
  if (msg.type === "dashboardData") {
    render(msg.payload);
  } else if (msg.type === "sessionDetailData") {
    isBackgroundLoading = false;
    if (msg.payload) {
      allSessionDetails.set(msg.payload.sessionId, msg.payload);
    }
    renderAllThreads();
    renderThreadDetail();
    loadNextFromQueue();
  } else if (msg.type === "exportComplete") {
    // Only markdown and timeline PNG exports are currently supported.
    const btnId = msg.exportType === "markdown" ? "db-btn-export-md" : "db-btn-export-png-health";
    setExportLoading(btnId, false);
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function fmtDate(dateStr: string): string {
  try {
    // Append 'T00:00:00Z' to force UTC parsing so the display date is
    // timezone-independent (YYYY-MM-DD strings represent whole days).
    const d = new Date(`${dateStr}T00:00:00Z`);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Initialisation — render from embedded data immediately (fast first paint)
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupExportButtons();
  setupTabs();

  if (window.__dashboardData) {
    render(window.__dashboardData);
    // Restore the last active tab after rendering.
    const saved = vscode.getState();
    if (saved?.currentTab && VALID_TABS.has(saved.currentTab)) {
      switchTab(saved.currentTab);
    }
  }
});
