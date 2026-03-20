import { useEffect, useRef } from "react";
import type { TooltipItem } from "chart.js";
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
  Tooltip,
} from "chart.js";
import type { ContextBucket, TurnBucket } from "../../src/ui/dashboardMessages";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

interface Props {
  turnStats: TurnBucket[];
  contextStats: ContextBucket[];
}

export function TurnContextCharts({ turnStats, contextStats }: Props) {
  const hasTurnData = turnStats.some((b) => b.sessionCount > 0);
  const hasContextData = contextStats.some((b) => b.sessionCount > 0);

  return (
    <>
      {hasTurnData && <TurnChurnChart turnStats={turnStats} />}
      {hasContextData && <ContextLeverageChart contextStats={contextStats} />}
    </>
  );
}

function TurnChurnChart({ turnStats }: { turnStats: TurnBucket[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const blue = getCssVar("--vscode-charts-blue") || "#0078d4";
    const green = getCssVar("--vscode-charts-green") || "#16825d";
    const foreground = getCssVar("--vscode-foreground") || "#cccccc";
    const grid = "rgba(128,128,128,0.15)";

    const labels = turnStats.map((b) => b.bucket);
    const sessionCounts = turnStats.map((b) => b.sessionCount);
    const resolutionRates = turnStats.map((b) =>
      b.sessionCount > 0 ? Math.round((b.acceptedCount / b.sessionCount) * 1000) / 10 : 0,
    );

    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar" as const,
            label: "Sessions",
            data: sessionCounts,
            backgroundColor: `${blue}99`,
            borderColor: blue,
            borderWidth: 1,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yLeft",
          },
          {
            type: "line" as const,
            label: "Resolution Rate (%)",
            data: resolutionRates,
            borderColor: green,
            backgroundColor: `${green}33`,
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yRight",
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, labels: { color: foreground } },
          tooltip: {
            callbacks: {
              label: (item: TooltipItem<"bar" | "line">) =>
                item.datasetIndex === 1
                  ? `Resolution Rate: ${item.formattedValue}%`
                  : `Sessions: ${item.formattedValue}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: foreground }, grid: { color: grid } },
          // biome-ignore lint/style/useNamingConvention: Chart.js API
          yLeft: {
            type: "linear" as const,
            position: "left" as const,
            title: { display: true, text: "Session Count", color: foreground },
            ticks: { color: foreground },
            grid: { color: grid },
            beginAtZero: true,
          },
          // biome-ignore lint/style/useNamingConvention: Chart.js API
          yRight: {
            type: "linear" as const,
            position: "right" as const,
            title: { display: true, text: "Resolution Rate (%)", color: foreground },
            ticks: { color: foreground, callback: (v) => `${v}%` },
            grid: { drawOnChartArea: false },
            beginAtZero: true,
            max: 100,
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [turnStats]);

  return (
    <>
      <hr className="db-section-sep" />
      <h2>🔄 Chat Session Turn Count &amp; Resolution Rate</h2>
      <p style={{ fontSize: "12px", opacity: 0.7, margin: "0 0 12px" }}>
        Bars show session volume per turn-count bucket. The line shows the resolution rate (% of sessions where code was
        copied or applied).
      </p>
      <div className="chart-container" style={{ minHeight: "300px", maxHeight: "320px" }}>
        <canvas ref={canvasRef} />
      </div>
    </>
  );
}

function ContextLeverageChart({ contextStats }: { contextStats: ContextBucket[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const blue = getCssVar("--vscode-charts-blue") || "#0078d4";
    const green = getCssVar("--vscode-charts-green") || "#16825d";
    const foreground = getCssVar("--vscode-foreground") || "#cccccc";
    const grid = "rgba(128,128,128,0.15)";

    const labels = contextStats.map((b) => b.referenceCount);
    const sessionCounts = contextStats.map((b) => b.sessionCount);
    const acceptanceRates = contextStats.map((b) =>
      b.sessionCount > 0 ? Math.round((b.acceptedCount / b.sessionCount) * 1000) / 10 : 0,
    );

    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar" as const,
            label: "Sessions",
            data: sessionCounts,
            backgroundColor: `${blue}99`,
            borderColor: blue,
            borderWidth: 1,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yLeft",
          },
          {
            type: "line" as const,
            label: "Acceptance Rate (%)",
            data: acceptanceRates,
            borderColor: green,
            backgroundColor: `${green}33`,
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            // biome-ignore lint/style/useNamingConvention: Chart.js API
            yAxisID: "yRight",
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, labels: { color: foreground } },
          tooltip: {
            callbacks: {
              label: (item: TooltipItem<"bar" | "line">) =>
                item.datasetIndex === 1
                  ? `Acceptance Rate: ${item.formattedValue}%`
                  : `Sessions: ${item.formattedValue}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: foreground }, grid: { color: grid } },
          // biome-ignore lint/style/useNamingConvention: Chart.js API
          yLeft: {
            type: "linear" as const,
            position: "left" as const,
            title: { display: true, text: "Session Count", color: foreground },
            ticks: { color: foreground },
            grid: { color: grid },
            beginAtZero: true,
          },
          // biome-ignore lint/style/useNamingConvention: Chart.js API
          yRight: {
            type: "linear" as const,
            position: "right" as const,
            title: { display: true, text: "Acceptance Rate (%)", color: foreground },
            ticks: { color: foreground, callback: (v) => `${v}%` },
            grid: { drawOnChartArea: false },
            beginAtZero: true,
            max: 100,
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [contextStats]);

  return (
    <>
      <hr className="db-section-sep" />
      <h2>📎 Context Leverage — Reference Count vs Acceptance Rate</h2>
      <p style={{ fontSize: "12px", opacity: 0.7, margin: "0 0 12px" }}>
        Bars show session volume per reference-count bucket. The line shows the acceptance rate (% of sessions where
        code was accepted) for each bucket.
      </p>
      <div className="chart-container" style={{ minHeight: "300px", maxHeight: "320px" }}>
        <canvas ref={canvasRef} />
      </div>
    </>
  );
}
