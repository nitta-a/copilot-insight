import { ArcElement, Chart, DoughnutController, Legend, Tooltip, type TooltipItem } from "chart.js";
import { useEffect, useRef } from "react";
import type { CountBreakdownEntry } from "../../../src/ui/dashboardMessages";

Chart.register(ArcElement, DoughnutController, Legend, Tooltip);

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

interface Props {
  entries: CountBreakdownEntry[];
  title: string;
  canvasId?: string;
}

export function DonutChart({ entries, title, canvasId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    if (entries.length === 0) return;

    const foreground =
      getComputedStyle(document.body).getPropertyValue("--vscode-foreground").trim() || "#cccccc";
    const labels = entries.map((e) => e.name);
    const data = entries.map((e) => e.count);
    const colors = entries.map((_, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]);

    chartRef.current = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderColor: "transparent", hoverOffset: 6 }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "right",
            labels: { color: foreground, boxWidth: 12, padding: 10, font: { size: 12 } },
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
          id: `${canvasId ?? "donut"}-center-label`,
          afterDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const total = (chart.data.datasets[0]?.data as number[]).reduce((s, v) => s + (v as number), 0);
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;
            ctx.fillStyle = foreground;
            ctx.font = "bold 18px var(--vscode-font-family, sans-serif)";
            ctx.fillText(String(total), cx, cy - 8);
            ctx.font = "11px var(--vscode-font-family, sans-serif)";
            ctx.globalAlpha = 0.65;
            ctx.fillText(title, cx, cy + 10);
            ctx.restore();
          },
        },
      ],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [entries, title, canvasId]);

  if (entries.length === 0) return null;
  return <canvas ref={canvasRef} style={{ maxHeight: "220px", maxWidth: "420px" }} />;
}
