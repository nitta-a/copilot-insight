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
import type { SessionDetailPayload, SessionThreadSummary } from "../src/types";
import type {
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
import { fmtDate } from "./dashboardUtils";
import {
  buildAgentIntelligenceOverviewHtml,
  buildContextFreshnessHtml,
  buildInsightsHtml,
  buildRefreshAnalysisHtml,
  buildSelectedThreadHtml,
  buildSummaryCardsHtml,
  buildThreadListHtml,
  buildWeeklyTrendHtml,
  getSelectableThreadsSorted,
} from "./htmlBuilders";

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
  el.innerHTML = buildSummaryCardsHtml(summary);
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
  el.innerHTML = buildInsightsHtml(insights);
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
