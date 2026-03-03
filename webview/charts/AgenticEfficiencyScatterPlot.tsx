/**
 * AgenticEfficiencyScatterPlot
 *
 * A scatter / bubble chart that plots each model as a bubble:
 *   X  — Avg Calls / Loop  (thinking depth)
 *   Y  — Completion Rate % (task success)
 *   Z  — Autonomous Duration (bubble size, proportional to total active time)
 *
 * Models in the top-right corner think deeply AND complete tasks reliably.
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
  type TooltipContentProps,
} from "recharts";
import type { AgentIntelligenceOverview } from "../../src/ui/dashboardMessages";

type ModelEntry = AgentIntelligenceOverview["autonomousRatioByModel"][number];

interface Props {
  data: ModelEntry[];
}

/** Minimum bubble area in px² (applied to the smallest Z value). */
const MIN_BUBBLE_SIZE = 40;
/** Default maximum bubble area in px² when no duration data is unusually large. */
const DEFAULT_MAX_BUBBLE_SIZE = 400;
/** Absolute cap on bubble area in px² to prevent excessively large bubbles. */
const ABSOLUTE_MAX_BUBBLE_SIZE = 800;
/** Scale factor: bubble area ≈ autonomousDurationMs / DURATION_SCALE_FACTOR. */
const DURATION_SCALE_FACTOR = 10;

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || "#ffffff";
}

interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  model: string;
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
  const durationSec = Math.round(point.z / 1000);
  const durationStr =
    durationSec < 60
      ? `${durationSec}s`
      : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
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
      <p style={{ margin: "2px 0" }}>Avg Calls / Loop: {point.x.toFixed(2)}</p>
      <p style={{ margin: "2px 0" }}>Completion Rate: {point.y.toFixed(1)}%</p>
      <p style={{ margin: "2px 0" }}>Autonomous Duration: {durationStr}</p>
    </div>
  );
}

export function AgenticEfficiencyScatterPlot({ data }: Props) {
  if (data.length === 0) {
    return null;
  }

  const fg = getCssVar("--vscode-editor-foreground");
  const grid = getCssVar("--vscode-editorWidget-border") || getCssVar("--vscode-panel-border") || "#444";
  const bubbleColor = getCssVar("--vscode-charts-purple") || "#a371f7";

  const chartData: ScatterPoint[] = data.map((d) => ({
    x: d.avgLoopActions,
    y: d.completionRate,
    z: d.autonomousDurationMs,
    model: d.model,
  }));

  // Z range: map autonomousDurationMs to a bubble area range (min 40, max 400 px²)
  const maxDuration = Math.max(...chartData.map((p) => p.z), 1);
  const zRange: [number, number] = [MIN_BUBBLE_SIZE, Math.max(DEFAULT_MAX_BUBBLE_SIZE, Math.min(ABSOLUTE_MAX_BUBBLE_SIZE, maxDuration / DURATION_SCALE_FACTOR))];

  return (
    <div style={{ width: "100%" }}>
      <h3 style={{ fontSize: "0.9em", margin: "16px 0 8px", color: fg, opacity: 0.85 }}>
        Agentic Efficiency — Depth vs Completion Rate
      </h3>
      <p style={{ fontSize: "0.78em", margin: "0 0 8px", color: fg, opacity: 0.6 }}>
        Bubble size = Autonomous Duration. Top-right = deep thinking + high success.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 32, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} opacity={0.4} />
          <XAxis
            type="number"
            dataKey="x"
            name="Avg Calls / Loop"
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Avg Calls / Loop",
              position: "insideBottom",
              offset: -8,
              style: { fill: fg, fontSize: 10 },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Completion Rate"
            domain={[0, 100]}
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Completion Rate (%)",
              angle: -90,
              position: "insideLeft",
              style: { fill: fg, fontSize: 10 },
              offset: 8,
            }}
          />
          <ZAxis type="number" dataKey="z" range={zRange} name="Autonomous Duration" />
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
