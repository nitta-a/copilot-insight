import type { DashboardPayload } from "../../src/ui/dashboardMessages";

const LATENCY_WARN_MS = 500;

interface Props {
  summary: DashboardPayload["summary"];
}

export function KpiGrid({ summary }: Props) {
  const totalHours = (summary.totalMinutesSaved.total / 60).toFixed(1);
  const editorHours = (summary.totalMinutesSaved.editor / 60).toFixed(1);
  const cliHours = (summary.totalMinutesSaved.cli / 60).toFixed(1);
  const isLatencyWarn = (summary.avgLatencyMs ?? 0) > LATENCY_WARN_MS;

  return (
    <div className="kpi-grid" aria-label="Key Performance Indicators">
      <div className="kpi-card">
        <div className="kpi-value">{summary.totalAccepted}</div>
        <div className="kpi-label">Accepted Completions</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-value">{summary.acceptanceRate.toFixed(1)}%</div>
        <div className="kpi-label">Acceptance Rate</div>
      </div>
      <div className="kpi-card" title={`Editor: ${editorHours}h / CLI: ${cliHours}h`}>
        <div className="kpi-value">{totalHours}h</div>
        <div className="kpi-label">Time Saved (ROI)</div>
        <span className="sub-text">
          Editor: {editorHours}h / CLI: {cliHours}h
        </span>
      </div>
      <div
        className={`kpi-card${isLatencyWarn ? " kpi-latency-warn" : ""}`}
        title={
          isLatencyWarn ? `Latency is high (>${LATENCY_WARN_MS}ms). Copilot responses may feel slow.` : undefined
        }
      >
        <div className="kpi-value">
          {(summary.avgLatencyMs ?? 0) > 0 ? `${(summary.avgLatencyMs ?? 0).toFixed(0)}ms` : "—"}
        </div>
        <div className="kpi-label">Avg Latency{isLatencyWarn ? " ⚠️" : ""}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-value">{summary.totalSessions}</div>
        <div className="kpi-label">Active Sessions</div>
      </div>
    </div>
  );
}
