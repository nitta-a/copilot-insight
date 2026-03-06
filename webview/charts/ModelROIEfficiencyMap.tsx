/**
 * ModelROIEfficiencyMap
 *
 * A scatter / bubble chart that visualises the ROI efficiency of each model:
 *   X  — Acceptance Rate %   (inline completion quality)
 *   Y  — Total Time Saved    (typing + agentic minutes freed up)
 *   Z  — Total Accepted      (bubble size, proportional to inline completion volume)
 *
 * Models in the top-right "High Efficiency Area" have a high acceptance rate
 * AND save significant developer time.
 *
 * Props: array of per-model entries from AgentIntelligenceOverview.autonomousRatioByModel
 */

import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  type TooltipContentProps,
} from "recharts";
import type { AgentIntelligenceOverview } from "../../src/ui/dashboardMessages";

type ModelEntry = AgentIntelligenceOverview["autonomousRatioByModel"][number];

interface Props {
  data: ModelEntry[];
}

/** Minimum bubble area in px² (applied to the smallest Z value). */
const MIN_BUBBLE_SIZE = 40;
/** Default maximum bubble area in px² when acceptance volume is not unusually large. */
const DEFAULT_MAX_BUBBLE_SIZE = 400;
/** Absolute cap on bubble area in px² to prevent excessively large bubbles. */
const ABSOLUTE_MAX_BUBBLE_SIZE = 800;
/** Scale factor: bubble area ≈ totalAccepted / ACCEPTED_SCALE_FACTOR. */
const ACCEPTED_SCALE_FACTOR = 1;

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || "#ffffff";
}

interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  model: string;
  acceptanceRate: number;
  totalTimeSaved: number;
  totalAccepted: number;
}

function CustomTooltip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) {
    return null;
  }
  const point = payload[0]?.payload as ScatterPoint | undefined;
  if (!point) {
    return null;
  }
  const fg = getCssVar("--vscode-editor-foreground");
  const bg = getCssVar("--vscode-editorWidget-background") || getCssVar("--vscode-editor-background");
  const border = getCssVar("--vscode-widget-border") || getCssVar("--vscode-editorWidget-border");
  const timeSavedStr =
    point.totalTimeSaved < 1
      ? `${Math.round(point.totalTimeSaved * 60)}s`
      : `${point.totalTimeSaved.toFixed(1)} min`;
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        padding: "8px 12px",
        color: fg,
        fontSize: 12,
      }}
    >
      <p style={{ margin: "0 0 4px", fontWeight: "bold" }}>{point.model}</p>
      <p style={{ margin: "2px 0" }}>Acceptance Rate: {point.acceptanceRate.toFixed(1)}%</p>
      <p style={{ margin: "2px 0" }}>Time Saved: {timeSavedStr}</p>
      <p style={{ margin: "2px 0" }}>Total Accepted: {point.totalAccepted}</p>
    </div>
  );
}

export function ModelROIEfficiencyMap({ data }: Props) {
  if (data.length === 0) {
    return null;
  }

  const fg = getCssVar("--vscode-editor-foreground");
  const grid = getCssVar("--vscode-editorWidget-border") || getCssVar("--vscode-panel-border") || "#444";
  const bubbleColor = getCssVar("--vscode-charts-green") || "#3fb950";
  const highEffAreaColor = getCssVar("--vscode-charts-yellow") || "#e3b341";

  const chartData: ScatterPoint[] = data.map((d) => ({
    x: d.acceptanceRate,
    y: d.totalTimeSaved,
    z: d.totalAccepted,
    model: d.model,
    acceptanceRate: d.acceptanceRate,
    totalTimeSaved: d.totalTimeSaved,
    totalAccepted: d.totalAccepted,
  }));

  const maxAccepted = Math.max(...chartData.map((p) => p.z), 1);
  const zRange: [number, number] = [
    MIN_BUBBLE_SIZE,
    Math.min(ABSOLUTE_MAX_BUBBLE_SIZE, Math.max(DEFAULT_MAX_BUBBLE_SIZE, maxAccepted / ACCEPTED_SCALE_FACTOR)),
  ];

  // Midpoints for the "High Efficiency Area" reference lines
  const maxX = Math.max(...chartData.map((p) => p.x), 100);
  const maxY = Math.max(...chartData.map((p) => p.y), 1);
  const midX = maxX / 2;
  const midY = maxY / 2;

  return (
    <div style={{ width: "100%" }}>
      <h3 style={{ fontSize: "0.9em", margin: "16px 0 8px", color: fg, opacity: 0.85 }}>
        Model ROI Efficiency Map
      </h3>
      <p style={{ fontSize: "0.78em", margin: "0 0 8px", color: fg, opacity: 0.6 }}>
        Bubble size = Total Accepted completions. Top-right = high acceptance rate + maximum time saved.
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 16, right: 48, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} opacity={0.4} />
          {/* High Efficiency Area background — top-right quadrant */}
          <ReferenceArea
            x1={midX}
            x2={maxX * 1.05}
            y1={midY}
            y2={maxY * 1.2}
            fill={highEffAreaColor}
            fillOpacity={0.07}
            stroke={highEffAreaColor}
            strokeOpacity={0.3}
            strokeDasharray="4 4"
            label={{
              value: "⭐ High Efficiency",
              position: "insideTopRight",
              style: { fill: highEffAreaColor, fontSize: 10, opacity: 0.8 },
            }}
          />
          {/* Reference lines at the midpoints */}
          <ReferenceLine
            x={midX}
            stroke={fg}
            strokeOpacity={0.2}
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={midY}
            stroke={fg}
            strokeOpacity={0.2}
            strokeDasharray="4 4"
          />
          <XAxis
            type="number"
            dataKey="x"
            name="Acceptance Rate"
            domain={[0, 100]}
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Acceptance Rate (%)",
              position: "insideBottom",
              offset: -8,
              style: { fill: fg, fontSize: 10 },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Time Saved"
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Time Saved (min)",
              angle: -90,
              position: "insideLeft",
              style: { fill: fg, fontSize: 10 },
              offset: 8,
            }}
          />
          <ZAxis type="number" dataKey="z" range={zRange} name="Total Accepted" />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip content={(props: any) => <CustomTooltip {...props} />} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter
            data={chartData}
            fill={bubbleColor}
            fillOpacity={0.75}
            stroke={bubbleColor}
            strokeWidth={1}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
