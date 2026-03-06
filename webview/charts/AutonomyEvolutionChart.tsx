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
import type { EvolutionPoint } from "../../src/ui/dashboardMessages";

interface Props {
  data: EvolutionPoint[];
}

interface TooltipPoint extends EvolutionPoint {
  dateLabel: string;
}

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || "#ffffff";
}

function formatDateLabel(date: string): string {
  try {
    const parsed = new Date(`${date}T00:00:00Z`);
    return `${String(parsed.getUTCMonth() + 1).padStart(2, "0")}/${String(parsed.getUTCDate()).padStart(2, "0")}`;
  } catch {
    return date;
  }
}

function CustomTooltip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) {
    return null;
  }
  const point = payload[0]?.payload as TooltipPoint | undefined;
  if (!point) {
    return null;
  }
  const fg = getCssVar("--vscode-editor-foreground");
  const bg = getCssVar("--vscode-editorWidget-background") || getCssVar("--vscode-editor-background");
  const border = getCssVar("--vscode-widget-border") || getCssVar("--vscode-editorWidget-border");
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
      <p style={{ margin: "0 0 4px", fontWeight: "bold" }}>{point.date}</p>
      <p style={{ margin: "2px 0" }}>Autonomous Volume: {point.totalDurationMin.toFixed(2)} min</p>
      <p style={{ margin: "2px 0" }}>Thinking Depth: {point.avgDepth.toFixed(2)} steps</p>
      <p style={{ margin: "2px 0" }}>Success Rate: {point.completionRate.toFixed(1)}%</p>
    </div>
  );
}

export function AutonomyEvolutionChart({ data }: Props) {
  if (data.length === 0) {
    return null;
  }

  const fg = getCssVar("--vscode-editor-foreground");
  const grid = getCssVar("--vscode-editorWidget-border") || getCssVar("--vscode-panel-border") || "#444";
  const barColor = getCssVar("--vscode-charts-blue") || "#007acc";
  const lineColor = getCssVar("--vscode-textLink-activeForeground") || "#005fb8";

  const chartData: TooltipPoint[] = data.map((point) => ({
    ...point,
    dateLabel: formatDateLabel(point.date),
  }));

  return (
    <div style={{ width: "100%" }}>
      <p style={{ fontSize: "0.78em", margin: "0 0 8px", color: fg, opacity: 0.6 }}>
        Daily autonomous runtime volume on the left axis, average actions per loop on the right axis.
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 44, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} opacity={0.4} />
          <XAxis dataKey="dateLabel" tick={{ fill: fg, fontSize: 11 }} />
          <YAxis
            yAxisId="left"
            tick={{ fill: fg, fontSize: 11 }}
            label={{
              value: "Autonomous Volume (min)",
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
              value: "Thinking Depth (steps)",
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
            dataKey="totalDurationMin"
            name="Autonomous Volume"
            fill={barColor}
            fillOpacity={0.35}
            stroke={barColor}
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgDepth"
            name="Thinking Depth"
            stroke={lineColor}
            strokeWidth={2}
            dot={{ fill: lineColor, r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}