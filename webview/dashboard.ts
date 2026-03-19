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
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart,
  DoughnutController,
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
import type { SessionDetailPayload, SessionThreadSummary } from "../src/types";
import type {
  ContextFreshness,
  CountBreakdownEntry,
  DashboardPayload,
  HostToWebviewMessage,
  PromptInsightsData,
  SessionsData,
  TimelineEntry,
  WebviewToHostMessage,
  WeeklyTrendData,
} from "../src/ui/dashboardMessages";
import { AgenticEfficiencyScatterPlot } from "./charts/AgenticEfficiencyScatterPlot";
import { AutonomyEvolutionChart } from "./charts/AutonomyEvolutionChart";
import { ModelAutonomyLeverageMap } from "./charts/ModelAutonomyLeverageMap";
import { ModelDepthVelocityChart } from "./charts/ModelDepthVelocityChart";
import { fmtDate } from "./dashboardUtils";
import {
  buildAgentIntelligenceOverviewHtml,
  buildContextFreshnessHtml,
  buildInsightsHtml,
  buildRefreshAnalysisHtml,
  buildSelectedThreadHtml,
  buildSummaryCardsHtml,
  buildTagCloudHtml,
  buildThreadListHtml,
  buildWeeklyTrendHtml,
  getSelectableThreadsSorted,
} from "./htmlBuilders";

// Register only the Chart.js components we actually use (tree-shaking).
Chart.register(
  ArcElement,
  BubbleController,
  CategoryScale,
  DoughnutController,
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
let intentDonutChart: Chart | null = null;
let commandDonutChart: Chart | null = null;
let promptLengthScatterChart: Chart | null = null;
let turnChurnChart: Chart | null = null;
let contextLeverageChart: Chart | null = null;
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
let promptInsightsLoaded = false;
let sessionsLoaded = false;
/** Set of tab names for which a `requestTabData` is currently in-flight. */
const pendingTabRequests = new Set<string>();

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
  el.innerHTML = buildSummaryCardsHtml(summary);
}

// ---------------------------------------------------------------------------
// Chat Intent & Command Usage Doughnut Charts
// ---------------------------------------------------------------------------

/** Palette for doughnut chart segments (cycles when more entries than colours). */
const DONUT_PALETTE = [
  "#0078d4",
  "#16825d",
  "#b180d7",
  "#cca700",
  "#f14c4c",
  "#00b7c3",
  "#e8721c",
  "#8764b8",
  "#5ea1d8",
  "#73c991",
];

function buildDonutChart(
  canvasId: string,
  entries: CountBreakdownEntry[],
  title: string,
  existingChart: Chart | null,
): Chart | null {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) {
    return existingChart;
  }
  if (existingChart) {
    existingChart.destroy();
  }
  if (entries.length === 0) {
    canvas.style.display = "none";
    return null;
  }
  canvas.style.display = "";

  const labels = entries.map((e) => e.name);
  const data = entries.map((e) => e.count);
  const colors = entries.map((_, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]);
  const c = getColors();

  return new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: "transparent",
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: false },
        legend: {
          position: "right",
          labels: {
            color: c.foreground,
            boxWidth: 12,
            padding: 10,
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"doughnut">) => {
              const total = (item.dataset.data as number[]).reduce((s, v) => s + v, 0);
              const val = item.raw as number;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
              return ` ${item.label}: ${val} (${pct}%)`;
            },
          },
        },
      },
    },
    plugins: [
      {
        id: `${canvasId}-center-label`,
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          if (!chartArea) {
            return;
          }
          const total = (chart.data.datasets[0]?.data as number[]).reduce((s, v) => s + (v as number), 0);
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          ctx.fillStyle = c.foreground;
          ctx.font = "bold 18px var(--vscode-font-family, sans-serif)";
          ctx.fillText(String(total), cx, cy - 8);
          ctx.font = "11px var(--vscode-font-family, sans-serif)";
          ctx.fillStyle = c.foreground;
          ctx.globalAlpha = 0.65;
          ctx.fillText(title, cx, cy + 10);
          ctx.restore();
        },
      },
    ],
  });
}

function renderChatIntentCommandDonutCharts(data: Pick<PromptInsightsData, "chatIntentBreakdown" | "commandUsageBreakdown">): void {
  const container = document.getElementById("db-intent-command-donut-container");
  if (!container) {
    return;
  }
  const hasIntent = data.chatIntentBreakdown.length > 0;
  const hasCommand = data.commandUsageBreakdown.length > 0;

  if (!hasIntent && !hasCommand) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <hr class="db-section-sep">
    <h2>🍩 Chat Intent &amp; Command Usage</h2>
    <div style="display:flex;flex-wrap:wrap;gap:32px;margin-top:16px;align-items:flex-start">
      <div style="flex:1;min-width:240px">
        <h3 style="margin:0 0 8px;font-size:13px;font-weight:600">Intent Breakdown</h3>
        <canvas id="db-intent-donut" style="max-height:220px;max-width:420px"></canvas>
        ${!hasIntent ? '<p class="no-data">No intent data available.</p>' : ""}
      </div>
      <div style="flex:1;min-width:240px">
        <h3 style="margin:0 0 8px;font-size:13px;font-weight:600">Command &amp; Participant Usage</h3>
        <canvas id="db-command-donut" style="max-height:220px;max-width:420px"></canvas>
        ${!hasCommand ? '<p class="no-data" style="font-size:12px;opacity:0.7">No slash command or @participant data detected in logs.</p>' : ""}
      </div>
    </div>`;

  intentDonutChart = buildDonutChart("db-intent-donut", data.chatIntentBreakdown, "intents", intentDonutChart);
  commandDonutChart = buildDonutChart("db-command-donut", data.commandUsageBreakdown, "commands", commandDonutChart);
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
  const editorInline = timeline.map((e) => e.editorAccepted);
  const editorChat = timeline.map((e) => e.chatCount);
  const cliAccepted = timeline.map((e) => e.cliAccepted);
  const rates = timeline.map((e) => e.rate);
  const trueRates = timeline.map((e) =>
    e.trueAccepted !== null ? (e.trueAccepted / Math.max(e.shown, 1)) * 100 : null,
  );
  const hasTrueRates = trueRates.some((r) => r !== null);

  // Per-point styling for anomaly detection.
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
          stack: "rate",
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
          label: "Editor (Inline)",
          data: editorInline,
          backgroundColor: `${c.blue}B3`,
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yCount",
          stack: "usage",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Editor (Chat)",
          data: editorChat,
          backgroundColor: `${c.green}B3`,
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yCount",
          stack: "usage",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "CLI",
          data: cliAccepted,
          backgroundColor: `${c.purple}B3`,
          // biome-ignore lint/style/useNamingConvention: Chart.js API property
          yAxisID: "yCount",
          stack: "usage",
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
          stack: "rate",
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
        x: { ticks: { color: c.foreground }, grid: { color: c.grid }, stacked: true },
        yCount: {
          type: "linear" as const,
          position: "left" as const,
          beginAtZero: true,
          stacked: true,
          ticks: { color: c.foreground },
          grid: { color: c.grid },
          title: { display: true, text: "Count", color: c.foreground },
        },
        yRate: {
          type: "linear" as const,
          position: "right" as const,
          beginAtZero: true,
          max: 100,
          stacked: false,
          ticks: { color: c.foreground, callback: (v) => `${v}%` },
          grid: { display: false },
          title: { display: true, text: "Rate (%)", color: c.foreground },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Prompt Length vs Acceptance Rate Scatter (Bubble) Chart
// ---------------------------------------------------------------------------

function renderPromptLengthScatterChart(scatterData: DashboardPayload["promptLengthScatterData"]): void {
  const container = document.getElementById("db-prompt-length-scatter-container");
  if (!container) {
    return;
  }

  if (scatterData.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <hr class="db-section-sep">
    <h2>🔍 Prompt Length vs Acceptance Rate</h2>
    <p style="font-size:12px;opacity:0.7;margin:0 0 12px">Bubble size represents number of samples (shown). Data from Copilot CLI interactions.</p>
    <div class="chart-container" style="max-height:320px">
      <canvas id="db-prompt-length-scatter-chart" style="max-height:320px"></canvas>
    </div>`;

  const canvas = document.getElementById("db-prompt-length-scatter-chart") as HTMLCanvasElement | null;
  if (!canvas) {
    return;
  }

  if (promptLengthScatterChart) {
    promptLengthScatterChart.destroy();
  }

  const c = getColors();

  promptLengthScatterChart = new Chart(canvas, {
    type: "bubble",
    data: {
      datasets: [
        {
          label: "Prompt Length Buckets",
          data: scatterData,
          backgroundColor: `${c.blue}99`,
          borderColor: c.blue,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"bubble">) => {
              const raw = item.raw as { x: number; y: number; r: number };
              return `Midpoint: ${raw.x} chars | Acceptance: ${raw.y.toFixed(1)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Prompt Length (Chars)", color: c.foreground },
          ticks: { color: c.foreground },
          grid: { color: c.grid },
          beginAtZero: true,
        },
        y: {
          title: { display: true, text: "Acceptance Rate (%)", color: c.foreground },
          ticks: { color: c.foreground, callback: (v) => `${v}%` },
          grid: { color: c.grid },
          beginAtZero: true,
          max: 100,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Turn Churn Mixed Chart (chat session turn-count distribution)
// ---------------------------------------------------------------------------

function renderTurnChurnChart(turnStats: DashboardPayload["turnStats"]): void {
  const container = document.getElementById("db-turn-churn-container");
  if (!container) {
    return;
  }

  const hasData = turnStats.some((b) => b.sessionCount > 0);
  if (!hasData) {
    container.innerHTML = "";
    if (turnChurnChart) {
      turnChurnChart.destroy();
      turnChurnChart = null;
    }
    return;
  }

  container.innerHTML = `
    <hr class="db-section-sep">
    <h2>🔄 Chat Session Turn Count & Resolution Rate</h2>
    <p style="font-size:12px;opacity:0.7;margin:0 0 12px">
      Bars show session volume per turn-count bucket. The line shows the resolution rate
      (% of sessions where code was copied or applied).
    </p>
    <div class="chart-container" style="min-height:300px;max-height:320px">
      <canvas id="db-turn-churn-chart"></canvas>
    </div>`;

  const canvas = document.getElementById("db-turn-churn-chart") as HTMLCanvasElement | null;
  if (!canvas) {
    return;
  }

  if (turnChurnChart) {
    turnChurnChart.destroy();
  }

  const c = getColors();
  const labels = turnStats.map((b) => b.bucket);
  const sessionCounts = turnStats.map((b) => b.sessionCount);
  const resolutionRates = turnStats.map((b) =>
    // Round to one decimal place: (acceptedCount / sessionCount) * 100
    b.sessionCount > 0 ? Math.round((b.acceptedCount / b.sessionCount) * 1000) / 10 : 0,
  );

  turnChurnChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Sessions",
          data: sessionCounts,
          backgroundColor: `${c.blue}99`,
          borderColor: c.blue,
          borderWidth: 1,
          yAxisID: "yLeft",
        },
        {
          type: "line",
          label: "Resolution Rate (%)",
          data: resolutionRates,
          borderColor: c.green,
          backgroundColor: `${c.green}33`,
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          yAxisID: "yRight",
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: c.foreground } },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"bar" | "line">) => {
              if (item.datasetIndex === 1) {
                return `Resolution Rate: ${item.formattedValue}%`;
              }
              return `Sessions: ${item.formattedValue}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: c.foreground },
          grid: { color: c.grid },
        },
        yLeft: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Session Count", color: c.foreground },
          ticks: { color: c.foreground },
          grid: { color: c.grid },
          beginAtZero: true,
        },
        yRight: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Resolution Rate (%)", color: c.foreground },
          ticks: { color: c.foreground, callback: (v) => `${v}%` },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
          max: 100,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Context Leverage Mixed Chart (context reference-count distribution)
// ---------------------------------------------------------------------------

function renderContextLeverageChart(contextStats: DashboardPayload["contextStats"]): void {
  const container = document.getElementById("db-context-leverage-container");
  if (!container) {
    return;
  }

  const hasData = contextStats.some((b) => b.sessionCount > 0);
  if (!hasData) {
    container.innerHTML = "";
    if (contextLeverageChart) {
      contextLeverageChart.destroy();
      contextLeverageChart = null;
    }
    return;
  }

  container.innerHTML = `
    <hr class="db-section-sep">
    <h2>📎 Context Leverage — Reference Count vs Acceptance Rate</h2>
    <p style="font-size:12px;opacity:0.7;margin:0 0 12px">
      Bars show session volume per reference-count bucket. The line shows the acceptance rate
      (% of sessions where code was accepted) for each bucket.
    </p>
    <div class="chart-container" style="min-height:300px;max-height:320px">
      <canvas id="db-context-leverage-chart"></canvas>
    </div>`;

  const canvas = document.getElementById("db-context-leverage-chart") as HTMLCanvasElement | null;
  if (!canvas) {
    return;
  }

  if (contextLeverageChart) {
    contextLeverageChart.destroy();
  }

  const c = getColors();
  const labels = contextStats.map((b) => b.referenceCount);
  const sessionCounts = contextStats.map((b) => b.sessionCount);
  const acceptanceRates = contextStats.map((b) =>
    b.sessionCount > 0 ? Math.round((b.acceptedCount / b.sessionCount) * 1000) / 10 : 0,
  );

  contextLeverageChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Sessions",
          data: sessionCounts,
          backgroundColor: `${c.blue}99`,
          borderColor: c.blue,
          borderWidth: 1,
          yAxisID: "yLeft",
        },
        {
          type: "line",
          label: "Acceptance Rate (%)",
          data: acceptanceRates,
          borderColor: c.green,
          backgroundColor: `${c.green}33`,
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          yAxisID: "yRight",
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: c.foreground } },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"bar" | "line">) => {
              if (item.datasetIndex === 1) {
                return `Acceptance Rate: ${item.formattedValue}%`;
              }
              return `Sessions: ${item.formattedValue}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: c.foreground },
          grid: { color: c.grid },
        },
        yLeft: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Session Count", color: c.foreground },
          ticks: { color: c.foreground },
          grid: { color: c.grid },
          beginAtZero: true,
        },
        yRight: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Acceptance Rate (%)", color: c.foreground },
          ticks: { color: c.foreground, callback: (v) => `${v}%` },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
          max: 100,
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
  el.innerHTML = buildInsightsHtml(insights);
}

function renderTagCloud(topKeywords: DashboardPayload["topKeywords"]): void {
  const el = document.getElementById("db-tag-cloud-container");
  if (!el) {
    return;
  }
  el.innerHTML = buildTagCloudHtml(topKeywords);
}

function renderContextFreshness(
  freshness: ContextFreshness | null,
  refreshAnalysis: DashboardPayload["refreshAnalysis"],
): void {
  const el = document.getElementById("db-freshness-container");
  if (!el) {
    return;
  }
  el.innerHTML = buildContextFreshnessHtml(freshness, refreshAnalysis);
}

function renderRefreshAnalysis(refreshAnalysis: DashboardPayload["refreshAnalysis"]): void {
  const el = document.getElementById("db-refresh-analysis-container");
  if (!el) {
    return;
  }
  el.innerHTML = buildRefreshAnalysisHtml(refreshAnalysis);
}

// ---------------------------------------------------------------------------
// Weekly trend
// ---------------------------------------------------------------------------

function renderWeeklyTrend(trend: WeeklyTrendData | null): void {
  const el = document.getElementById("db-weekly-trend-container");
  if (!el) {
    return;
  }
  el.innerHTML = buildWeeklyTrendHtml(trend);
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

const VALID_TABS = new Set(["overview", "health", "flow", "prompt-insights", "sessions"]);

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
  if (tabId === "prompt-insights" && promptInsightsLoaded) {
    intentDonutChart?.resize();
    commandDonutChart?.resize();
    promptLengthScatterChart?.resize();
    turnChurnChart?.resize();
    contextLeverageChart?.resize();
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

function renderAgentIntelligenceOverview(agenticStats: DashboardPayload["agenticStats"]): void {
  const el = document.getElementById("db-agent-intelligence-container");
  if (!el) {
    return;
  }

  const hasFeatureSignals = [
    agenticStats.featureSignals.browserTools.total,
    agenticStats.featureSignals.pluginOrSkills.total,
    agenticStats.featureSignals.memoryManagement.total,
    agenticStats.featureSignals.agentDebug.total,
  ].some((total) => total > 0);

  if (agenticStats.subagentRequests === 0 && !hasFeatureSignals) {
    depthVelocityChartRoot = unmountRoot(depthVelocityChartRoot);
    scatterPlotRoot = unmountRoot(scatterPlotRoot);
    el.innerHTML = '<p class="no-data">No autonomous activity or 1.110 feature signals detected in this period.</p>';
    return;
  }

  el.innerHTML = buildAgentIntelligenceOverviewHtml(agenticStats);

  // Mount React chart components into the containers just added.
  const modelData = agenticStats.agentIntelligenceOverview.autonomousRatioByModel;

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

function renderAllThreads(): void {
  const el = document.getElementById("db-session-list");
  if (!el) {
    return;
  }
  const flat: Array<{ thread: SessionThreadSummary; sessionId: string }> = [];
  for (const [sessionId, detail] of allSessionDetails) {
    for (const thread of detail.threads.filter((t) => t.stepCount > 0)) {
      flat.push({ thread, sessionId });
    }
  }
  flat.sort((a, b) => Date.parse(b.thread.startedAt) - Date.parse(a.thread.startedAt));
  el.innerHTML = buildThreadListHtml(
    flat,
    selectedThreadId,
    selectedThreadSessionId,
    isBackgroundLoading,
    sessionLoadQueue.length,
  );
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
  const html = buildSelectedThreadHtml(detail, selectedThreadId);
  // Sync selectedThreadId if buildSelectedThreadHtml fell back to the first thread.
  const firstThread = getSelectableThreadsSorted(detail.threads)[0];
  if (firstThread && !detail.threads.find((t) => t.threadId === selectedThreadId && t.stepCount > 0)) {
    selectedThreadId = firstThread.threadId;
  }
  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Lazy-loaded tab rendering
// ---------------------------------------------------------------------------

const LOAD_BTN_LABELS: Record<string, string> = {
  "db-btn-load-prompt-insights": "📊 Load Prompt Insights",
  "db-btn-load-sessions": "📂 Load Sessions",
};

function setLoadButtonState(btnId: string, loading: boolean): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  if (!btn) {
    return;
  }
  btn.disabled = loading;
  if (loading) {
    btn.innerHTML = '<span class="db-loading-spinner"></span>Loading…';
  } else {
    btn.textContent = LOAD_BTN_LABELS[btnId] ?? btn.textContent;
  }
}

function showLazyContent(placeholderId: string, contentId: string): void {
  const placeholder = document.getElementById(placeholderId);
  const content = document.getElementById(contentId);
  if (placeholder) {
    placeholder.style.display = "none";
  }
  if (content) {
    content.style.display = "";
  }
}

function renderPromptInsightsData(data: PromptInsightsData): void {
  promptInsightsLoaded = true;
  showLazyContent("db-prompt-insights-lazy", "db-prompt-insights-content");
  renderTagCloud(data.topKeywords);
  renderChatIntentCommandDonutCharts(data);
  renderPromptLengthScatterChart(data.promptLengthScatterData);
  renderTurnChurnChart(data.turnStats);
  renderContextLeverageChart(data.contextStats);
  // Trigger resize so charts render correctly after becoming visible.
  if (currentTab === "prompt-insights") {
    intentDonutChart?.resize();
    commandDonutChart?.resize();
    promptLengthScatterChart?.resize();
    turnChurnChart?.resize();
    contextLeverageChart?.resize();
  }
}

function renderSessionsData(data: SessionsData): void {
  sessionsLoaded = true;
  showLazyContent("db-sessions-lazy", "db-sessions-content");
  for (const session of data.sessionSummaries) {
    if (!allSessionDetails.has(session.sessionId)) {
      sessionLoadQueue.push(session.sessionId);
    }
  }
  loadNextFromQueue();
  renderAllThreads();
  renderThreadDetail();
}

function requestTabData(tab: "promptInsights" | "sessions"): void {
  vscode.postMessage({ type: "requestTabData", tab } satisfies WebviewToHostMessage);
}

/**
 * Attach a click handler to a lazy-load button that:
 * 1. Guards against duplicate in-flight requests.
 * 2. Shows a loading spinner while the request is pending.
 * 3. Posts the requestTabData message to the host.
 */
function attachLazyLoadButton(btnId: string, tab: "promptInsights" | "sessions", isLoaded: () => boolean): void {
  document.getElementById(btnId)?.addEventListener("click", () => {
    if (isLoaded() || pendingTabRequests.has(tab)) {
      return;
    }
    pendingTabRequests.add(tab);
    setLoadButtonState(btnId, true);
    requestTabData(tab);
  });
}

function setupLazyLoadButtons(): void {
  attachLazyLoadButton("db-btn-load-prompt-insights", "promptInsights", () => promptInsightsLoaded);
  attachLazyLoadButton("db-btn-load-sessions", "sessions", () => sessionsLoaded);
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
  // Prompt Insights and Sessions tabs are lazy-loaded on demand.
  promptInsightsLoaded = false;
  sessionsLoaded = false;
  pendingTabRequests.clear();
  allSessionDetails.clear();
  sessionLoadQueue.length = 0;
  isBackgroundLoading = false;
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
  } else if (msg.type === "tabData") {
    if (msg.tab === "promptInsights") {
      pendingTabRequests.delete("promptInsights");
      renderPromptInsightsData(msg.payload as PromptInsightsData);
    } else if (msg.tab === "sessions") {
      pendingTabRequests.delete("sessions");
      renderSessionsData(msg.payload as SessionsData);
    }
  } else if (msg.type === "exportComplete") {
    // Only markdown and timeline PNG exports are currently supported.
    const btnId = msg.exportType === "markdown" ? "db-btn-export-md" : "db-btn-export-png-health";
    setExportLoading(btnId, false);
  }
});

// ---------------------------------------------------------------------------
// Initialisation — render from embedded data immediately (fast first paint)
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupExportButtons();
  setupTabs();
  setupLazyLoadButtons();

  if (window.__dashboardData) {
    render(window.__dashboardData);
    // Restore the last active tab after rendering.
    const saved = vscode.getState();
    if (saved?.currentTab && VALID_TABS.has(saved.currentTab)) {
      switchTab(saved.currentTab);
    }
  }
});
