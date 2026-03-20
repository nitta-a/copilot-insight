import { BubbleController, Chart, Legend, LinearScale, PointElement, Tooltip, type TooltipItem } from "chart.js";
import { useEffect, useRef } from "react";

Chart.register(BubbleController, LinearScale, PointElement, Legend, Tooltip);

interface BubblePoint {
  x: number;
  y: number;
  r: number;
}

interface Props {
  data: BubblePoint[];
  xLabel: string;
  yLabel: string;
}

export function BubbleChart({ data, xLabel, yLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    if (data.length === 0) return;

    const blue = getComputedStyle(document.body).getPropertyValue("--vscode-charts-blue").trim() || "#0078d4";
    const foreground =
      getComputedStyle(document.body).getPropertyValue("--vscode-foreground").trim() || "#cccccc";
    const grid = "rgba(128,128,128,0.15)";

    chartRef.current = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: [
          {
            label: `${yLabel} by ${xLabel}`,
            data,
            backgroundColor: `${blue}80`,
            borderColor: blue,
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
                const pt = item.raw as BubblePoint;
                return `${xLabel}: ${pt.x} chars  |  ${yLabel}: ${pt.y.toFixed(1)}%  |  samples ∝ r=${pt.r}`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: xLabel, color: foreground },
            ticks: { color: foreground },
            grid: { color: grid },
          },
          y: {
            title: { display: true, text: yLabel, color: foreground },
            ticks: { color: foreground, callback: (v) => `${v}%` },
            grid: { color: grid },
            min: 0,
            max: 100,
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [data, xLabel, yLabel]);

  if (data.length === 0) return null;
  return <canvas ref={canvasRef} style={{ maxHeight: "280px" }} />;
}
