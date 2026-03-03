/**
 * Dashboard WebView frontend — runs inside VS Code's WebviewPanel.
 *
 * Responsibilities:
 * - Render two Chart.js visualisations:
 *   1. True Acceptance Rate Timeline (bar + line combo)
 *   2. Flow & Velocity Correlation scatter plot
 * - Handle period-change and export button interactions.
 * - Persist UI state (selected period) across tab switches via
 *   `vscode.getState()` / `vscode.setState()`.
 *
 * Communication:
 * - Listens for `dashboardData` messages from the extension host.
 * - Posts `changePeriod`, `exportMarkdown`, and `exportPng` messages back.
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
  ScatterController,
  Title,
  Tooltip,
  type TooltipItem,
} from "chart.js";

import type {
  DashboardPayload,
  HostToWebviewMessage,
  TimelineEntry,
  VelocityPoint,
  WebviewToHostMessage,
  WeeklyTrendData,
} from "../src/ui/dashboardMessages";

// Register only the Chart.js components we actually use (tree-shaking).
Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  BarController,
  LineController,
  ScatterController,
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
  getState(): { days?: number; currentTab?: string } | undefined;
  setState(state: { days?: number; currentTab?: string }): void;
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
let velocityChart: Chart | null = null;
let currentDays = 14;
let currentTab = "overview";

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
  const hours = (summary.estimatedMinutesSaved / 60).toFixed(1);
  const bestModelStr = summary.bestModel ?? "—";

  el.innerHTML = `
    <div class="stat-card db-highlight">
      <div class="stat-value db-accent">${trueRateStr}</div>
      <div class="stat-label">True Acceptance Rate</div>
      <div class="stat-detail">vs ${summary.acceptanceRate.toFixed(1)}% raw</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-accent">${summary.estimatedMinutesSaved.toFixed(0)} min</div>
      <div class="stat-label">Estimated Time Saved</div>
      <div class="stat-detail">${hours} hours (ROI)</div>
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
// Velocity / flow correlation scatter chart
// ---------------------------------------------------------------------------

function renderVelocityChart(points: VelocityPoint[]): void {
  const section = document.getElementById("db-velocity-section");
  const canvas = document.getElementById("db-velocity-chart") as HTMLCanvasElement | null;

  if (points.length === 0) {
    if (section) {
      section.style.display = "none";
    }
    return;
  }

  if (section) {
    section.style.display = "";
  }
  if (!canvas) {
    return;
  }

  const c = getColors();
  const maxComp = Math.max(...points.map((p) => p.completionsAccepted), 1);
  const normal = points.filter((p) => !p.flowDisrupted);
  const disrupted = points.filter((p) => p.flowDisrupted);

  if (velocityChart) {
    velocityChart.destroy();
  }

  velocityChart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Normal Flow",
          data: normal.map((p) => ({ x: p.kpm, y: (p.completionsAccepted / maxComp) * 100 })),
          backgroundColor: `${c.blue}cc`,
          pointRadius: 5,
        },
        {
          label: "Flow Disrupted",
          data: disrupted.map((p) => ({ x: p.kpm, y: (p.completionsAccepted / maxComp) * 100 })),
          backgroundColor: `${c.red}cc`,
          pointRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: c.foreground } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const pt = item.raw as { x: number; y: number };
              const src = item.datasetIndex === 0 ? normal : disrupted;
              const srcPt = src[item.dataIndex];
              const timeStr = srcPt ? new Date(srcPt.windowStart).toLocaleTimeString() : "";
              const lines = [`KPM: ${pt.x.toFixed(0)}`, `Completions: ${srcPt?.completionsAccepted ?? 0}`];
              if (timeStr) {
                lines.push(`Time: ${timeStr}`);
              }
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Keystrokes Per Minute (KPM)", color: c.foreground },
          ticks: { color: c.foreground },
          grid: { color: c.grid },
        },
        y: {
          title: { display: true, text: "Relative Completion Activity (%)", color: c.foreground },
          beginAtZero: true,
          max: 100,
          ticks: { color: c.foreground, callback: (v) => `${v}%` },
          grid: { color: c.grid },
        },
      },
    },
  });
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
    .map((text) => `<div class="insight-card"><span class="insight-icon"></span>${escHtml(text)}</div>`)
    .join("\n");
  el.innerHTML = `<h2>💡 Insights</h2>\n<div class="insights-section">${cards}</div>`;
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
// Period selector
// ---------------------------------------------------------------------------

function renderPeriodSelector(activeDays: number): void {
  const el = document.getElementById("db-period-selector");
  if (!el) {
    return;
  }

  el.innerHTML = [7, 14, 30]
    .map((d) => {
      const cls = d === activeDays ? "db-period-btn active" : "db-period-btn";
      return `<button class="${cls}" data-days="${d}">${d} days</button>`;
    })
    .join("");

  el.querySelectorAll<HTMLButtonElement>(".db-period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.days);
      currentDays = days;
      vscode.setState({ days, currentTab });
      // Show loading state while waiting for updated data.
      const interactive = document.getElementById("db-interactive");
      if (interactive) {
        interactive.style.opacity = "0.6";
        interactive.style.pointerEvents = "none";
      }
      vscode.postMessage({ type: "changePeriod", payload: { days } } satisfies WebviewToHostMessage);
    });
  });
}

// ---------------------------------------------------------------------------
// Export buttons
// ---------------------------------------------------------------------------

function setupExportButtons(): void {
  document.getElementById("db-btn-export-md")?.addEventListener("click", () => {
    vscode.postMessage({ type: "exportMarkdown" } satisfies WebviewToHostMessage);
  });

  document.getElementById("db-btn-export-png")?.addEventListener("click", () => {
    const canvas = document.getElementById("db-timeline-chart") as HTMLCanvasElement | null;
    const imageData = canvas?.toDataURL("image/png") ?? "";
    vscode.postMessage({ type: "exportPng", payload: { imageData } } satisfies WebviewToHostMessage);
  });
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

const VALID_TABS = new Set(["overview", "health", "flow"]);

function switchTab(tabId: string): void {
  currentTab = tabId;
  vscode.setState({ days: currentDays, currentTab: tabId });

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
  } else if (tabId === "flow" && velocityChart) {
    velocityChart.resize();
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
// Full render
// ---------------------------------------------------------------------------

function render(payload: DashboardPayload): void {
  currentDays = payload.days;
  renderAnomalyBanner(payload.timeline);
  renderSummaryCards(payload.summary);
  renderInsights(payload.insights);
  renderWeeklyTrend(payload.weeklyTrend);
  renderTimelineChart(payload.timeline);
  renderVelocityChart(payload.velocityPoints);
  renderPeriodSelector(payload.days);
  // Clear loading state set by the period selector.
  const interactive = document.getElementById("db-interactive");
  if (interactive) {
    interactive.style.opacity = "";
    interactive.style.pointerEvents = "";
  }
}

// ---------------------------------------------------------------------------
// Message handler (host → webview updates)
// ---------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
  const msg = event.data;
  if (msg.type === "dashboardData") {
    render(msg.payload);
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
    const initData = window.__dashboardData;
    // Restore persisted period and substitute it directly into the initial
    // data to avoid a flash of incorrectly-filtered content.
    const saved = vscode.getState();
    if (saved?.days && saved.days !== initData.days) {
      currentDays = saved.days;
      // Request updated data from the host in the background.
      vscode.postMessage({ type: "changePeriod", payload: { days: saved.days } } satisfies WebviewToHostMessage);
      // Render immediately with the saved-days label so the period buttons
      // already reflect the correct selection while waiting for the update.
      render({ ...initData, days: saved.days });
    } else {
      render(initData);
    }
    // Restore the last active tab after rendering.
    if (saved?.currentTab && VALID_TABS.has(saved.currentTab)) {
      switchTab(saved.currentTab);
    }
  }
});
