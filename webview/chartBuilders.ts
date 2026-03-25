/**
 * Chart.js factory functions — pure chart-creation utilities with no DOM
 * side-effects beyond the canvas element passed in as a parameter.
 *
 * All Chart.js component registration lives here so the rest of the webview
 * bundle never needs to import from "chart.js" directly.
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
import type { CountBreakdownEntry, PromptInsightsData, TimelineEntry } from "../src/ui/dashboardMessages";
import { fmtDate } from "./dashboardUtils";

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
// Constants
// ---------------------------------------------------------------------------

/**
 * Distinct hardcoded red used exclusively for statistical anomaly data points.
 * Using a fixed colour (rather than the theme's `--vscode-charts-red`) ensures
 * anomaly points are immediately recognisable across light, dark, and
 * high-contrast themes where the theme red may blend with other series.
 */
export const ANOMALY_POINT_COLOR = "#FF4B4B";

/** Palette for doughnut chart segments (cycles when more entries than colours). */
export const DONUT_PALETTE = [
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

// ---------------------------------------------------------------------------
// Theme helpers — read VS Code CSS variables for chart colours
// ---------------------------------------------------------------------------

export interface ChartColors {
  blue: string;
  green: string;
  orange: string;
  red: string;
  purple: string;
  foreground: string;
  grid: string;
}

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

export function getColors(): ChartColors {
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
// Doughnut chart factory
// ---------------------------------------------------------------------------

export function buildDonutChart(
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

// ---------------------------------------------------------------------------
// Timeline chart factory (bar + line combo)
// ---------------------------------------------------------------------------

export function createTimelineChart(canvas: HTMLCanvasElement, timeline: TimelineEntry[], c: ChartColors): Chart {
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

  return new Chart(canvas, {
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
// Prompt Length vs Acceptance Rate Scatter (Bubble) chart factory
// ---------------------------------------------------------------------------

export function createPromptLengthScatterChart(
  canvas: HTMLCanvasElement,
  scatterData: PromptInsightsData["promptLengthScatterData"],
  c: ChartColors,
): Chart {
  return new Chart(canvas, {
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
// Turn Churn Mixed chart factory (bar + line)
// ---------------------------------------------------------------------------

export function createTurnChurnChart(
  canvas: HTMLCanvasElement,
  turnStats: PromptInsightsData["turnStats"],
  c: ChartColors,
): Chart {
  const labels = turnStats.map((b) => b.bucket);
  const sessionCounts = turnStats.map((b) => b.sessionCount);
  const resolutionRates = turnStats.map((b) =>
    // Round to one decimal place: (acceptedCount / sessionCount) * 100
    b.sessionCount > 0 ? Math.round((b.acceptedCount / b.sessionCount) * 1000) / 10 : 0,
  );

  return new Chart(canvas, {
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
