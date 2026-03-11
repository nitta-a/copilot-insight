/**
 * Dashboard WebView frontend — runs inside VS Code's WebviewPanel.
 *
 * Responsibilities:
 * - Render KPI cards (Total Accepted, Acceptance Rate, Time Saved, Sessions).
 * - Render a Chart.js Acceptance Rate Timeline (efficiency graph).
 * - Render the Session Summary Table.
 * - Render auto-generated insight cards.
 * - Handle the Markdown export button.
 * - Re-render whenever a `dashboardData` message arrives from the host.
 *
 * Communication:
 * - Listens for `dashboardData` messages from the extension host.
 * - Posts `exportMarkdown` message on button click.
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
} from "chart.js";
import type {
  DashboardPayload,
  HostToWebviewMessage,
  WebviewToHostMessage,
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
  Title,
  Tooltip,
  Legend,
);

// ---------------------------------------------------------------------------
// VS Code WebView API (injected as a global by VS Code)
// ---------------------------------------------------------------------------

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): Record<string, unknown> | undefined;
  setState(state: Record<string, unknown>): void;
};

interface DashboardWindow extends Window {
  __dashboardData?: DashboardPayload;
}

declare const window: DashboardWindow;

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

let efficiencyChart: Chart | null = null;

// ---------------------------------------------------------------------------
// Theme helpers — read VS Code CSS variables for chart colours
// ---------------------------------------------------------------------------

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function getColors() {
  return {
    blue: getCssVar("--vscode-charts-blue") || "#0078d4",
    green: getCssVar("--vscode-charts-green") || "#16825d",
    foreground: getCssVar("--vscode-foreground") || "#cccccc",
    grid: "rgba(128,128,128,0.15)",
  };
}

// ---------------------------------------------------------------------------
// KPI Cards
// ---------------------------------------------------------------------------

function formatTimeSaved(minutes: number): string {
  if (minutes >= 60) {
    return `${(minutes / 60).toFixed(1)}h`;
  }
  return `${minutes.toFixed(1)}m`;
}

function renderKpiCards(payload: DashboardPayload): void {
  const el = document.getElementById("kpi-cards");
  if (!el) {
    return;
  }
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-value">${payload.totalAccepted.toLocaleString()}</div>
      <div class="kpi-label">Total Accepted</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${payload.acceptanceRate.toFixed(1)}%</div>
      <div class="kpi-label">Acceptance Rate</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${formatTimeSaved(payload.estimatedTimeSaved)}</div>
      <div class="kpi-label">Est. Time Saved</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${payload.activeSessions.toLocaleString()}</div>
      <div class="kpi-label">Active Sessions</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Efficiency Graph (Chart.js)
// ---------------------------------------------------------------------------

function renderEfficiencyChart(payload: DashboardPayload): void {
  const canvas = document.getElementById("efficiency-chart") as HTMLCanvasElement | null;
  if (!canvas) {
    return;
  }

  // Destroy previous chart instance before creating a new one.
  if (efficiencyChart) {
    efficiencyChart.destroy();
    efficiencyChart = null;
  }

  const { timeline } = payload;
  if (timeline.length === 0) {
    const container = canvas.parentElement;
    if (container) {
      container.innerHTML = `<p class="no-data">No timeline data available.</p>`;
    }
    return;
  }

  const colors = getColors();
  const labels = timeline.map((t) => t.date);
  const rates = timeline.map((t) => Number(t.rate.toFixed(1)));
  const shown = timeline.map((t) => t.shown);
  const accepted = timeline.map((t) => t.accepted);

  efficiencyChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Acceptance Rate (%)",
          data: rates,
          borderColor: colors.green,
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: "yRate",
          tension: 0.3,
        },
        {
          type: "bar",
          label: "Shown",
          data: shown,
          backgroundColor: `${colors.blue}55`,
          borderColor: `${colors.blue}88`,
          borderWidth: 1,
          yAxisID: "yVol",
        },
        {
          type: "bar",
          label: "Accepted",
          data: accepted,
          backgroundColor: `${colors.green}66`,
          borderColor: `${colors.green}99`,
          borderWidth: 1,
          yAxisID: "yVol",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: colors.foreground, boxWidth: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.label === "Acceptance Rate (%)") {
                return ` Rate: ${ctx.parsed.y.toFixed(1)}%`;
              }
              return ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: colors.foreground, maxTicksLimit: 12, font: { size: 10 } },
          grid: { color: colors.grid },
        },
        yRate: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          ticks: {
            color: colors.green,
            callback: (v) => `${v}%`,
            font: { size: 10 },
          },
          grid: { display: false },
        },
        yVol: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          ticks: { color: colors.foreground, font: { size: 10 } },
          grid: { color: colors.grid },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function renderInsights(payload: DashboardPayload): void {
  const el = document.getElementById("insights-container");
  if (!el) {
    return;
  }
  if (payload.insights.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = payload.insights
    .map((text) => `<div class="insight-card">${escapeHtml(text)}</div>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Session Summary Table
// ---------------------------------------------------------------------------

function renderSessionTable(payload: DashboardPayload): void {
  const el = document.getElementById("session-table-container");
  if (!el) {
    return;
  }
  const { sessions } = payload;
  if (sessions.length === 0) {
    el.innerHTML = `<p class="no-data">No session data found.</p>`;
    return;
  }

  const rows = sessions
    .map(
      (s) =>
        `<tr>
          <td>${escapeHtml(s.date)}</td>
          <td>${s.accepted.toLocaleString()}</td>
          <td>${s.estimatedMinSaved.toFixed(1)} min</td>
        </tr>`,
    )
    .join("");

  el.innerHTML = `
    <table class="session-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Accepted</th>
          <th>Est. Time Saved</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Escape helper (no external dependency)
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Main render entry point
// ---------------------------------------------------------------------------

function render(payload: DashboardPayload): void {
  renderKpiCards(payload);
  renderEfficiencyChart(payload);
  renderInsights(payload);
  renderSessionTable(payload);
}

// ---------------------------------------------------------------------------
// Export button
// ---------------------------------------------------------------------------

document.getElementById("btn-export-md")?.addEventListener("click", () => {
  vscode.postMessage({ type: "exportMarkdown" });
});

// ---------------------------------------------------------------------------
// Message listener (host → webview updates)
// ---------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
  const msg = event.data;
  if (msg.type === "dashboardData") {
    render(msg.payload);
  }
});

// ---------------------------------------------------------------------------
// Initial render from embedded data
// ---------------------------------------------------------------------------

if (window.__dashboardData) {
  render(window.__dashboardData);
}
