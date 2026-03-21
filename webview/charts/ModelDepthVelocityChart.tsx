/**
 * ModelDepthVelocityChart
 *
 * A ComposedChart comparing "thinking depth" (Avg Calls / Loop) as bars and
 * "thinking speed" (Velocity in seconds/action) as a line, per model.
 *
 * Props: array of per-model entries from AgentIntelligenceOverview.autonomousRatioByModel
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { AgentIntelligenceOverview } from "../../src/ui/dashboardMessages";

type ModelEntry = AgentIntelligenceOverview["autonomousRatioByModel"][number];

interface Props {
  data: ModelEntry[];
}

/** Maximum characters to show for a model name on the X-axis. */
const MAX_LABEL_LENGTH = 16;
/** Number of characters to keep when truncating (leaves room for ellipsis). */
const LABEL_TRUNCATE_AT = 14;

function getCssVar(name: string): string {
  return (
    getComputedStyle(document.body).getPropertyValue(name).trim() || "#ffffff"
  );
}

interface CustomTooltipPayloadItem {
  name: string;
  value: number;
  color: string;
  unit?: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) {
    return null;
  }
  const fg = getCssVar("--vscode-editor-foreground");
  const bg =
    getCssVar("--vscode-editorWidget-background") ||
    getCssVar("--vscode-editor-background");
  const border =
    getCssVar("--vscode-widget-border") ||
    getCssVar("--vscode-editorWidget-border");
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
      <p style={{ margin: "0 0 4px", fontWeight: "bold" }}>{label}</p>
      {(payload as unknown as CustomTooltipPayloadItem[]).map((entry) => (
        <p key={entry.name} style={{ margin: "2px 0", color: entry.color }}>
          {entry.name}:{" "}
          {typeof entry.value === "number"
            ? entry.value.toFixed(2)
            : entry.value}
          {entry.unit ?? ""}
        </p>
      ))}
    </div>
  );
}

export function ModelDepthVelocityChart({ data }: Props) {
  // Exclude entries with no agentic depth data (e.g. Copilot CLI which has no loop metrics).
  const agenticData = data.filter(
    (d) => d.avgLoopActions > 0 || d.velocitySecondsPerAction > 0,
  );
  if (agenticData.length === 0) {
    return null;
  }

  const fg = getCssVar("--vscode-editor-foreground");
  const grid =
    getCssVar("--vscode-editorWidget-border") ||
    getCssVar("--vscode-panel-border") ||
    "#444";
  const barColor = getCssVar("--vscode-charts-blue") || "#007acc";
  const lineColor = getCssVar("--vscode-charts-orange") || "#e8a838";

  const chartData = agenticData.map((d) => ({
    model:
      d.model.length > MAX_LABEL_LENGTH
        ? `${d.model.slice(0, LABEL_TRUNCATE_AT)}…`
        : d.model,
    fullModel: d.model,
    avgLoopActions: Number(d.avgLoopActions.toFixed(2)),
    velocitySecondsPerAction: Number(d.velocitySecondsPerAction.toFixed(2)),
  }));

  return (
    <div style={{ width: "100%" }}>
      <h3
        style={{
          fontSize: "0.9em",
          margin: "0 0 8px",
          color: fg,
          opacity: 0.85,
        }}
      >
        Thinking Depth vs Speed by Model
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 48, left: 0, bottom: 32 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={grid} opacity={0.4} />
          <XAxis
            dataKey="model"
            tick={{ fill: fg, fontSize: 11 }}
            angle={-30}
            textAnchor="end"
            interval={0}
            height={60}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Avg Calls / Loop",
              angle: -90,
              position: "insideLeft",
              style: { fill: fg, fontSize: 10 },
              offset: 8,
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Velocity (s / action)",
              angle: 90,
              position: "insideRight",
              style: { fill: fg, fontSize: 10 },
              offset: 8,
            }}
          />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip content={(props: any) => <CustomTooltip {...props} />} />
          <Legend wrapperStyle={{ color: fg, fontSize: 12, paddingTop: 8 }} />
          <Bar
            yAxisId="left"
            dataKey="avgLoopActions"
            name="Avg Calls / Loop"
            fill={barColor}
            opacity={0.85}
            radius={[3, 3, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="velocitySecondsPerAction"
            name="Velocity (s / action)"
            stroke={lineColor}
            strokeWidth={2}
            dot={{ fill: lineColor, r: 4 }}
            unit="s"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
