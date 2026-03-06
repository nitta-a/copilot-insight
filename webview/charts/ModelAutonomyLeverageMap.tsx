/**
 * ModelAutonomyLeverageMap
 *
 * A scatter / bubble chart that visualises how strongly each model drives
 * autonomous work:
 *   X  — Autonomous Ratio %      (share of requests that became autonomous)
 *   Y  — Autonomous Duration Min (total active runtime)
 *   Z  — Autonomous Actions      (bubble size, proportional to subagent calls)
 *
 * Models in the top-right "High Leverage Area" are used autonomously often
 * and stay active for longer stretches.
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
/** Default maximum bubble area in px² when action volume is not unusually large. */
const DEFAULT_MAX_BUBBLE_SIZE = 400;
/** Absolute cap on bubble area in px² to prevent excessively large bubbles. */
const ABSOLUTE_MAX_BUBBLE_SIZE = 800;
/** Scale factor: bubble area ≈ subagentCount / ACTION_SCALE_FACTOR. */
const ACTION_SCALE_FACTOR = 1;

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || "#ffffff";
}

interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  model: string;
  ratio: number;
  autonomousDurationMinutes: number;
  autonomousDurationMs: number;
  subagentCount: number;
  totalCount: number;
}

function formatDuration(durationMs: number): string {
  const durationSec = Math.round(durationMs / 1000);
  if (durationSec < 60) {
    return `${durationSec}s`;
  }
  return `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
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
  const durationStr = formatDuration(point.autonomousDurationMs);
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
      <p style={{ margin: "2px 0" }}>Autonomous Ratio: {point.ratio.toFixed(1)}%</p>
      <p style={{ margin: "2px 0" }}>Autonomous Duration: {durationStr}</p>
      <p style={{ margin: "2px 0" }}>Autonomous Actions: {point.subagentCount}</p>
      <p style={{ margin: "2px 0" }}>Total Requests: {point.totalCount}</p>
    </div>
  );
}

export function ModelAutonomyLeverageMap({ data }: Props) {
  if (data.length === 0) {
    return null;
  }

  const fg = getCssVar("--vscode-editor-foreground");
  const grid = getCssVar("--vscode-editorWidget-border") || getCssVar("--vscode-panel-border") || "#444";
  const bubbleColor = getCssVar("--vscode-charts-green") || "#3fb950";
  const highEffAreaColor = getCssVar("--vscode-charts-yellow") || "#e3b341";
  const subtitle = "Bubble size = Autonomous Actions. Top-right = high autonomous share + long active runtime.";

  const chartData: ScatterPoint[] = data.map((d) => ({
    x: d.ratio,
    y: d.autonomousDurationMs / 60000,
    z: d.subagentCount,
    model: d.model,
    ratio: d.ratio,
    autonomousDurationMinutes: d.autonomousDurationMs / 60000,
    autonomousDurationMs: d.autonomousDurationMs,
    subagentCount: d.subagentCount,
    totalCount: d.totalCount,
  }));

  const maxActions = Math.max(...chartData.map((p) => p.z), 1);
  const zRange: [number, number] = [
    MIN_BUBBLE_SIZE,
    Math.min(ABSOLUTE_MAX_BUBBLE_SIZE, Math.max(DEFAULT_MAX_BUBBLE_SIZE, maxActions / ACTION_SCALE_FACTOR)),
  ];

  // Midpoints for the "High Leverage Area" reference lines
  const maxX = Math.max(...chartData.map((p) => p.x), 100);
  const maxY = Math.max(...chartData.map((p) => p.y), 1);
  const midX = maxX / 2;
  const midY = maxY / 2;

  return (
    <div style={{ width: "100%" }}>
      <h3 style={{ fontSize: "0.9em", margin: "16px 0 8px", color: fg, opacity: 0.85 }}>
        Model Autonomy Leverage Map
      </h3>
      <p style={{ fontSize: "0.78em", margin: "0 0 8px", color: fg, opacity: 0.6 }}>
        {subtitle}
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 16, right: 48, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} opacity={0.4} />
          {/* High Leverage Area background — top-right quadrant */}
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
              value: "⭐ High Leverage",
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
            name="Autonomous Ratio"
            domain={[0, 100]}
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Autonomous Ratio (%)",
              position: "insideBottom",
              offset: -8,
              style: { fill: fg, fontSize: 10 },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Autonomous Duration"
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Autonomous Duration (min)",
              angle: -90,
              position: "insideLeft",
              style: { fill: fg, fontSize: 10 },
              offset: 8,
            }}
          />
          <ZAxis type="number" dataKey="z" range={zRange} name="Autonomous Actions" />
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
