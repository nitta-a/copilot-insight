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
import { useEffect, useRef } from "react";
import type { TimelineEntry } from "../../../src/ui/dashboardMessages";
import { fmtDate } from "../../dashboardUtils";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
);

/** Distinct red used exclusively for anomaly data points. */
const ANOMALY_POINT_COLOR = "#FF4B4B";

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

interface Props {
  timeline: TimelineEntry[];
  /** Called whenever the Chart instance is (re)created, useful for PNG export. */
  onChartReady?: (chart: Chart) => void;
}

export function TimelineChart({ timeline, onChartReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const blue = getCssVar("--vscode-charts-blue") || "#0078d4";
    const green = getCssVar("--vscode-charts-green") || "#16825d";
    const orange = getCssVar("--vscode-charts-orange") || "#cca700";
    const purple = getCssVar("--vscode-charts-purple") || "#b180d7";
    const foreground = getCssVar("--vscode-foreground") || "#cccccc";
    const grid = "rgba(128,128,128,0.15)";

    const labels = timeline.map((e) => fmtDate(e.date));
    const editorInline = timeline.map((e) => e.editorAccepted);
    const editorChat = timeline.map((e) => e.chatCount);
    const cliAccepted = timeline.map((e) => e.cliAccepted);
    const rates = timeline.map((e) => e.rate);
    const trueRates = timeline.map((e) =>
      e.trueAccepted !== null ? (e.trueAccepted / Math.max(e.shown, 1)) * 100 : null,
    );
    const hasTrueRates = trueRates.some((r) => r !== null);

    const pointColors = timeline.map((e) => (e.isAnomaly ? ANOMALY_POINT_COLOR : orange));
    const pointBorderWidths = timeline.map((e) => (e.isAnomaly ? 2 : 1));
    const pointRadii = timeline.map((e) => (e.isAnomaly ? 8 : 3));

    const trueRateDataset = hasTrueRates
      ? [
          {
            type: "line" as const,
            label: "True Acceptance Rate (%)",
            data: trueRates as (number | null)[],
            borderColor: purple,
            backgroundColor: "transparent",
            // biome-ignore lint/style/useNamingConvention: Chart.js API
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

    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar" as const,
            label: "Editor (Inline)",
            data: editorInline,
            backgroundColor: `${blue}B3`,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yCount",
            stack: "usage",
            order: 2,
          },
          {
            type: "bar" as const,
            label: "Editor (Chat)",
            data: editorChat,
            backgroundColor: `${green}B3`,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yCount",
            stack: "usage",
            order: 2,
          },
          {
            type: "bar" as const,
            label: "CLI",
            data: cliAccepted,
            backgroundColor: `${purple}B3`,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yCount",
            stack: "usage",
            order: 2,
          },
          {
            type: "line" as const,
            label: "Acceptance Rate (%)",
            data: rates,
            borderColor: orange,
            backgroundColor: "transparent",
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yRate",
            borderWidth: 2,
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            pointBorderWidth: pointBorderWidths,
            pointRadius: pointRadii,
            tension: 0.3,
            order: 1,
            stack: "rate",
          },
          ...trueRateDataset,
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: foreground } },
          tooltip: {
            callbacks: {
              label: (item: TooltipItem<"bar" | "line">) => {
                const val = item.raw as number | null;
                if (val === null) return "";
                const isRate = item.dataset.label?.includes("Rate") ?? false;
                const base = `${item.dataset.label}: ${val.toFixed(isRate ? 1 : 0)}${isRate ? "%" : ""}`;
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
          x: { ticks: { color: foreground }, grid: { color: grid }, stacked: true },
          // biome-ignore lint/style/useNamingConvention: Chart.js API
          yCount: {
            type: "linear" as const,
            position: "left" as const,
            beginAtZero: true,
            stacked: true,
            ticks: { color: foreground },
            grid: { color: grid },
            title: { display: true, text: "Count", color: foreground },
          },
          // biome-ignore lint/style/useNamingConvention: Chart.js API
          yRate: {
            type: "linear" as const,
            position: "right" as const,
            beginAtZero: true,
            max: 100,
            stacked: false,
            ticks: {
              color: foreground,
              callback: (v) => `${v}%`,
            },
            grid: { display: false },
            title: { display: true, text: "Rate (%)", color: foreground },
          },
        },
      },
    });

    onChartReady?.(chartRef.current);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [timeline, onChartReady]);

  return <canvas ref={canvasRef} style={{ maxHeight: "280px" }} />;
}
