import { useCallback, useRef } from "react";
import type { Chart } from "chart.js";
import type { WebviewToHostMessage } from "../../src/ui/dashboardMessages";

export interface ChartExportHook {
  handleChartReady: (chart: Chart) => void;
  handleExportPng: () => void;
}

export function useChartExport(postMessage: (msg: WebviewToHostMessage) => void): ChartExportHook {
  const chartRef = useRef<Chart | null>(null);

  const handleChartReady = useCallback((chart: Chart) => {
    chartRef.current = chart;
  }, []);

  function handleExportPng() {
    const canvas = chartRef.current?.canvas;
    if (!canvas) return;
    const imageData = canvas.toDataURL("image/png");
    postMessage({ type: "exportPng", payload: { imageData, chartId: "timeline" } });
  }

  return { handleChartReady, handleExportPng };
}
