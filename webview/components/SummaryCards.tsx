import type { DashboardPayload } from "../../src/ui/dashboardMessages";
import { trunc } from "../dashboardUtils";

interface Props {
  summary: DashboardPayload["summary"];
}

export function SummaryCards({ summary }: Props) {
  const trueRateStr = summary.trueAcceptanceRate !== null ? `${summary.trueAcceptanceRate.toFixed(1)}%` : "—";
  const totalHours = (summary.totalMinutesSaved.total / 60).toFixed(1);
  const typingHours = (summary.typingMinutesSaved / 60).toFixed(1);
  const agenticHours = (summary.agenticMinutesSaved / 60).toFixed(1);
  const editorHours = (summary.totalMinutesSaved.editor / 60).toFixed(1);
  const cliHours = (summary.totalMinutesSaved.cli / 60).toFixed(1);
  const roiDetail =
    summary.agenticMinutesSaved > 0 ? `Typing: ${typingHours}h + AI: ${agenticHours}h` : `Typing: ${typingHours}h`;
  const sourceDetail = `Editor: ${editorHours}h / CLI: ${cliHours}h`;
  const topChatModelStr = summary.topChatModel ?? "—";
  const topChatModelDetail =
    summary.topChatModel && summary.topChatModelCount > 0
      ? `${summary.topChatModelCount} requests`
      : "no chat model data";
  const topAskModelStr = summary.topAskModel ?? "—";
  const topAskModelDetail =
    summary.topAskModel && summary.topAskModelCount > 0
      ? `${summary.topAskModelCount} requests`
      : "no ask model data";
  const topPlanModelStr = summary.topPlanModel ?? "—";
  const topPlanModelDetail =
    summary.topPlanModel && summary.topPlanModelCount > 0
      ? `${summary.topPlanModelCount} plan & agent calls`
      : "no plan or agent data";

  return (
    <div className="stats-grid">
      <div className="stat-card db-highlight">
        <div className="stat-value db-accent">{trueRateStr}</div>
        <div className="stat-label">True Acceptance Rate</div>
        <div className="stat-detail">vs {summary.acceptanceRate.toFixed(1)}% raw</div>
      </div>
      <div className="stat-card db-highlight" title={sourceDetail}>
        <div className="stat-value db-accent">{totalHours} hours</div>
        <div className="stat-label">Estimated Time Saved</div>
        <div className="stat-detail">{roiDetail}</div>
        <div className="stat-detail" style={{ opacity: 0.6, fontSize: "0.85em" }}>
          {sourceDetail}
        </div>
      </div>
      <div className="stat-card db-highlight">
        <div className="stat-value db-model" title={topChatModelStr}>
          {trunc(topChatModelStr, 18)}
        </div>
        <div className="stat-label">Top Chat Model</div>
        <div className="stat-detail">{topChatModelDetail}</div>
      </div>
      <div className="stat-card db-highlight">
        <div className="stat-value db-model" title={topAskModelStr}>
          {trunc(topAskModelStr, 18)}
        </div>
        <div className="stat-label">Top Ask Model</div>
        <div className="stat-detail">{topAskModelDetail}</div>
      </div>
      <div className="stat-card db-highlight">
        <div className="stat-value db-model" title={topPlanModelStr}>
          {trunc(topPlanModelStr, 18)}
        </div>
        <div className="stat-label">Top Plan Model</div>
        <div className="stat-detail">{topPlanModelDetail}</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{summary.totalShown}</div>
        <div className="stat-label">Suggestions Shown</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{summary.totalAccepted}</div>
        <div className="stat-label">Suggestions Accepted</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{summary.acceptanceRate.toFixed(1)}%</div>
        <div className="stat-label">Raw Acceptance Rate</div>
      </div>
    </div>
  );
}
