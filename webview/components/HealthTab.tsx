import type { DashboardPayload, TimelineEntry, WebviewToHostMessage } from "../../src/ui/dashboardMessages";
import { useChartExport } from "../hooks/useChartExport";
import { TimelineChart } from "./charts/TimelineChart";

interface Props {
  payload: DashboardPayload;
  hasMoreData: boolean;
  historicalPending: boolean;
  onLoadHistorical: () => void;
  postMessage: (msg: WebviewToHostMessage) => void;
}

export function HealthTab({ payload, hasMoreData, historicalPending, onLoadHistorical, postMessage }: Props) {
  const { timeline } = payload;
  const { handleChartReady, handleExportPng } = useChartExport(postMessage);

  const anomalies = timeline.filter((e) => e.isAnomaly);
  const latestAnomaly = anomalies.at(-1);

  return (
    <div id="db-tab-health" className="db-tab-pane active" role="tabpanel">
      {latestAnomaly && <AnomalyBanner anomalies={anomalies} latestAnomaly={latestAnomaly} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <h2 style={{ margin: 0 }}>📈 True Acceptance Rate Timeline</h2>
        <button className="db-export-btn" onClick={handleExportPng}>
          🖼️ Save Chart (PNG)
        </button>
      </div>
      <TimelineChart timeline={timeline} onChartReady={handleChartReady} />
      {hasMoreData && (
        <div style={{ marginTop: "16px", textAlign: "center" }}>
          <button className="db-load-btn" disabled={historicalPending} onClick={onLoadHistorical}>
            {historicalPending ? (
              <>
                <span className="db-loading-spinner" />
                Loading…
              </>
            ) : (
              "🕐 Load Historical Data"
            )}
          </button>
          <p style={{ margin: "4px 0 0", fontSize: "0.85em", opacity: 0.7 }}>
            Older sessions are available. Click to load the full history.
          </p>
        </div>
      )}
    </div>
  );
}

function AnomalyBanner({ anomalies, latestAnomaly }: { anomalies: TimelineEntry[]; latestAnomaly: TimelineEntry }) {
  const count = anomalies.length;
  const label = count === 1 ? "anomaly" : "anomalies";
  return (
    <div
      style={{
        background: "var(--vscode-inputValidation-warningBackground,#6c4f00)",
        border: "1px solid var(--vscode-inputValidation-warningBorder,#cca700)",
        borderRadius: "4px",
        padding: "10px 14px",
        marginBottom: "12px",
        fontSize: "13px",
      }}
    >
      <strong>
        ⚠️ {count} statistical {label} detected in the current period.
      </strong>
      <span>
        {" "}
        Latest: {latestAnomaly.date} — {latestAnomaly.anomalyReason ?? ""}
      </span>
    </div>
  );
}
