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

import type { Chart } from "chart.js";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SessionDetailPayload, SessionThreadSummary } from "../src/types";
import type {
  ContextFreshness,
  ContextRichnessData,
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
import {
  buildDonutChart,
  createContextLeverageChart,
  createPromptLengthScatterChart,
  createTimelineChart,
  createTurnChurnChart,
  getColors,
} from "./chartBuilders";
import { ModelAutonomyLeverageMap } from "./charts/ModelAutonomyLeverageMap";
import { ModelDepthVelocityChart } from "./charts/ModelDepthVelocityChart";
import type {
  ContextCorrelationChart,
  ContextFreshnessMeter,
  ContextRichnessMeter,
  TagCloud,
  ThreadList,
  ThreadSelectDetail,
  WeeklyTrendCard,
} from "./components/index";
import "./components/index";
import {
  buildAgentIntelligenceOverviewHtml,
  buildInsightsHtml,
  buildRefreshAnalysisHtml,
  buildSelectedThreadHtml,
  buildSummaryCardsHtml,
  getSelectableThreadsSorted,
} from "./htmlBuilders";

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
let historicalDataPending = false;
/** Set of tab names for which a `requestTabData` is currently in-flight. */
const pendingTabRequests = new Set<string>();

/** Unmount a React root and return null, for concise cleanup. */
function unmountRoot(root: Root | null): null {
  root?.unmount();
  return null;
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

function renderChatIntentCommandDonutCharts(
  data: Pick<PromptInsightsData, "chatIntentBreakdown" | "commandUsageBreakdown">,
): void {
  const container = document.getElementById("db-intent-command-donut-container");
  if (!container) {
    return;
  }
  const { chatIntentBreakdown, commandUsageBreakdown } = data;
  const hasIntent = chatIntentBreakdown.length > 0;
  const hasCommand = commandUsageBreakdown.length > 0;

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

  intentDonutChart = buildDonutChart("db-intent-donut", chatIntentBreakdown, "intents", intentDonutChart);
  commandDonutChart = buildDonutChart("db-command-donut", commandUsageBreakdown, "commands", commandDonutChart);
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
  if (timelineChart) {
    timelineChart.destroy();
  }
  timelineChart = createTimelineChart(canvas, timeline, getColors());
}

// ---------------------------------------------------------------------------
// Prompt Length vs Acceptance Rate Scatter (Bubble) Chart
// ---------------------------------------------------------------------------

function renderPromptLengthScatterChart(scatterData: PromptInsightsData["promptLengthScatterData"]): void {
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
  promptLengthScatterChart = createPromptLengthScatterChart(canvas, scatterData, getColors());
}

// ---------------------------------------------------------------------------
// Turn Churn Mixed Chart (chat session turn-count distribution)
// ---------------------------------------------------------------------------

function renderTurnChurnChart(turnStats: PromptInsightsData["turnStats"]): void {
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
  turnChurnChart = createTurnChurnChart(canvas, turnStats, getColors());
}

// ---------------------------------------------------------------------------
// Context Leverage Mixed Chart (context reference-count distribution)
// ---------------------------------------------------------------------------

function renderContextLeverageChart(contextStats: PromptInsightsData["contextStats"]): void {
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
  contextLeverageChart = createContextLeverageChart(canvas, contextStats, getColors());
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

function renderTagCloud(topKeywords: PromptInsightsData["topKeywords"]): void {
  const el = document.getElementById("db-tag-cloud-container");
  if (!el) {
    return;
  }
  let comp = el.querySelector<TagCloud>("copilot-tag-cloud");
  if (!comp) {
    comp = document.createElement("copilot-tag-cloud") as TagCloud;
    el.innerHTML = "";
    el.appendChild(comp);
  }
  comp.tags = topKeywords;
}

function renderContextFreshness(
  freshness: ContextFreshness | null,
  refreshAnalysis: DashboardPayload["refreshAnalysis"],
): void {
  const el = document.getElementById("db-freshness-container");
  if (!el) {
    return;
  }
  let comp = el.querySelector<ContextFreshnessMeter>("copilot-freshness-meter");
  if (!comp) {
    comp = document.createElement("copilot-freshness-meter") as ContextFreshnessMeter;
    el.innerHTML = "";
    el.appendChild(comp);
  }
  comp.freshness = freshness;
  comp.refreshAnalysis = refreshAnalysis;
}

function renderContextRichness(richness: ContextRichnessData): void {
  const el = document.getElementById("db-context-richness-container");
  if (!el) {
    return;
  }
  let comp = el.querySelector<ContextRichnessMeter>("copilot-richness-meter");
  if (!comp) {
    comp = document.createElement("copilot-richness-meter") as ContextRichnessMeter;
    el.innerHTML = "";
    el.appendChild(comp);
  }
  comp.richness = richness;
}

function renderContextCorrelation(richness: ContextRichnessData): void {
  const el = document.getElementById("db-context-correlation-container");
  if (!el) {
    return;
  }
  let comp = el.querySelector<ContextCorrelationChart>("copilot-context-correlation");
  if (!comp) {
    comp = document.createElement("copilot-context-correlation") as ContextCorrelationChart;
    el.innerHTML = "";
    el.appendChild(comp);
  }
  comp.buckets = richness.buckets;
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
  let comp = el.querySelector<WeeklyTrendCard>("copilot-weekly-trend");
  if (!comp) {
    comp = document.createElement("copilot-weekly-trend") as WeeklyTrendCard;
    el.innerHTML = "";
    el.appendChild(comp);
  }
  comp.trendData = trend;
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
// Tab switching — handled by the <copilot-tab-panel> Web Component.
// This handler runs after the component dispatches a `tab-change` event so
// that Chart.js charts are resized and VS Code state is persisted.
// ---------------------------------------------------------------------------

const VALID_TABS = new Set(["overview", "health", "flow", "prompt-insights", "sessions"]);

function onTabChange(tabId: string): void {
  currentTab = tabId;
  vscode.setState({ currentTab: tabId });

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

function activateTab(tabId: string): void {
  // Update tab button states.
  document.querySelectorAll<HTMLElement>(".db-panel-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset["tab"] === tabId);
  });
  // Show/hide panel views.
  document.querySelectorAll<HTMLElement>(".db-panel-view").forEach((view) => {
    view.classList.toggle("active", view.id === `db-tab-${tabId}`);
  });
  onTabChange(tabId);
}

function setupTabChangeListener(): void {
  document.querySelectorAll<HTMLElement>(".db-panel-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset["tab"] ?? "";
      if (VALID_TABS.has(tabId)) {
        activateTab(tabId);
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

  const { featureSignals, subagentRequests, agentIntelligenceOverview } = agenticStats;
  const { browserTools, pluginOrSkills, memoryManagement, agentDebug } = featureSignals;
  const hasFeatureSignals = [browserTools.total, pluginOrSkills.total, memoryManagement.total, agentDebug.total].some(
    (total) => total > 0,
  );

  if (subagentRequests === 0 && !hasFeatureSignals) {
    depthVelocityChartRoot = unmountRoot(depthVelocityChartRoot);
    scatterPlotRoot = unmountRoot(scatterPlotRoot);
    el.innerHTML = '<p class="no-data">No autonomous activity or 1.110 feature signals detected in this period.</p>';
    return;
  }

  el.innerHTML = buildAgentIntelligenceOverviewHtml(agenticStats);

  // Mount React chart components into the containers just added.
  const modelData = agentIntelligenceOverview.autonomousRatioByModel;

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

  let comp = el.querySelector<ThreadList>("copilot-thread-list");
  if (!comp) {
    comp = document.createElement("copilot-thread-list") as ThreadList;
    comp.addEventListener("thread-select", (ev: Event) => {
      const { threadId, sessionId } = (ev as CustomEvent<ThreadSelectDetail>).detail;
      if (threadId && !(threadId === selectedThreadId && sessionId === selectedThreadSessionId)) {
        selectedThreadId = threadId;
        selectedThreadSessionId = sessionId;
        renderAllThreads();
        renderThreadDetail();
      }
    });
    el.innerHTML = "";
    el.appendChild(comp);
  }
  comp.flat = flat;
  comp.selectedThreadId = selectedThreadId;
  comp.selectedSessionId = selectedThreadSessionId;
  comp.isLoading = isBackgroundLoading;
  comp.queueLength = sessionLoadQueue.length;
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
  "db-btn-load-historical": "🕐 Load Historical Data",
};

function setLoadButtonState(btnId: string, loading: boolean): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  if (!btn) {
    return;
  }
  btn.disabled = loading;
  if (loading) {
    btn.innerHTML = '<span class="db-loading-spinner"></span>Loading\u2026';
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

  document.getElementById("db-btn-load-historical")?.addEventListener("click", () => {
    if (historicalDataPending) {
      return;
    }
    historicalDataPending = true;
    setLoadButtonState("db-btn-load-historical", true);
    vscode.postMessage({ type: "loadMoreData" } satisfies WebviewToHostMessage);
  });
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

function render(payload: DashboardPayload): void {
  currentPayload = payload;
  renderAnomalyBanner(payload.timeline);
  renderSummaryCards(payload.summary);
  renderContextFreshness(payload.freshness, payload.refreshAnalysis);
  renderContextRichness(payload.contextRichness);
  renderContextCorrelation(payload.contextRichness);
  renderRefreshAnalysis(payload.refreshAnalysis);
  renderInsights(payload.insights);
  renderWeeklyTrend(payload.weeklyTrend);
  renderAgentIntelligenceOverview(payload.agenticStats);
  renderAutonomyEvolution(payload.evolutionData);
  renderTimelineChart(payload.timeline);
  renderModelAutonomyLeverageMap(payload.agenticStats);

  // Show or hide the "Load Historical Data" section.
  const loadHistoricalContainer = document.getElementById("db-load-historical-container");
  if (loadHistoricalContainer) {
    loadHistoricalContainer.style.display = payload.hasMoreData ? "" : "none";
  }
  // Always reset the pending flag and button label whenever a fresh payload arrives,
  // so the button is re-enabled whether the request succeeded or failed.
  historicalDataPending = false;
  setLoadButtonState("db-btn-load-historical", false);

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
  setupTabChangeListener();
  setupLazyLoadButtons();

  if (window.__dashboardData) {
    render(window.__dashboardData);
    // Restore the last active tab after rendering.
    const saved = vscode.getState();
    if (saved?.currentTab && VALID_TABS.has(saved.currentTab)) {
      activateTab(saved.currentTab);
    }
  }
});
