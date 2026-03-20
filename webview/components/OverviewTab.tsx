import type {
  AgentIntelligenceOverview,
  ContextFreshness,
  DashboardPayload,
  WebviewToHostMessage,
} from "../../src/ui/dashboardMessages";
import { AgenticEfficiencyScatterPlot } from "../charts/AgenticEfficiencyScatterPlot";
import { AutonomyEvolutionChart } from "../charts/AutonomyEvolutionChart";
import { ModelDepthVelocityChart } from "../charts/ModelDepthVelocityChart";
import {
  formatDuration,
  formatSignedPercent,
  formatSignedPoints,
  getDeltaClass,
  getInsightClass,
  trunc,
} from "../dashboardUtils";
import { KpiGrid } from "./KpiGrid";
import { SummaryCards } from "./SummaryCards";

interface Props {
  payload: DashboardPayload;
  postMessage: (msg: WebviewToHostMessage) => void;
}

export function OverviewTab({ payload, postMessage }: Props) {
  const { summary, freshness, refreshAnalysis, insights, weeklyTrend, agenticStats, evolutionData } = payload;

  return (
    <div id="db-tab-overview" className="db-tab-pane active" role="tabpanel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span />
        <button className="db-export-btn" onClick={() => postMessage({ type: "exportMarkdown" })}>
          📄 Export Report (Markdown)
        </button>
      </div>
      <KpiGrid summary={summary} />
      <SummaryCards summary={summary} />
      <ContextFreshnessSection freshness={freshness} refreshAnalysis={refreshAnalysis} />
      <InsightsSection insights={insights} />
      <WeeklyTrendSection weeklyTrend={weeklyTrend} />
      <AgentIntelligenceSection agenticStats={agenticStats} />
      {evolutionData.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <hr className="db-section-sep" />
          <h2>📈 Autonomy Evolution</h2>
          <AutonomyEvolutionChart data={evolutionData} />
        </div>
      )}
    </div>
  );
}

// ── Context Freshness ──────────────────────────────────────────────────────

interface ContextFreshnessSectionProps {
  freshness: ContextFreshness | null;
  refreshAnalysis: DashboardPayload["refreshAnalysis"];
}
function ContextFreshnessSection({ freshness, refreshAnalysis }: ContextFreshnessSectionProps) {
  if (!freshness || refreshAnalysis.length === 0) return null;

  const score = Math.max(0, Math.min(100, freshness.score));
  const statusLabel = freshness.status === "fresh" ? "Fresh" : freshness.status === "aging" ? "Aging" : "Exhausted";
  const statusDetail =
    freshness.status === "fresh"
      ? "AI は絶好調"
      : freshness.status === "aging"
        ? "/compact を検討してください"
        : "セッションの再起動を推奨";
  const suggestion =
    freshness.suggestedAction === "none"
      ? "今はリフレッシュ不要です。"
      : freshness.suggestedAction === "compact"
        ? "次の大きなタスク前に /compact を挟むのが妥当です。"
        : "新しいセッションを開始した方が回復しやすい状態です。";
  const latestRoi = freshness.latestRefreshRoi !== null ? `+${(freshness.latestRefreshRoi * 100).toFixed(1)}%` : "N/A";
  const latestRecovery =
    freshness.latestRecoveryDelta !== null ? `${freshness.latestRecoveryDelta.toFixed(1)} pt` : "N/A";
  const latestRefresh = refreshAnalysis.at(-1) ?? null;
  const latestEventType = latestRefresh ? latestRefresh.event.type : "memory";
  const latestTimestamp = latestRefresh ? new Date(latestRefresh.event.timestamp).toLocaleString() : "";

  return (
    <>
      <h2>🧠 Context Freshness</h2>
      <div className="db-freshness-card">
        <div className="db-freshness-header">
          <div>
            <div className="db-freshness-status">{statusLabel}</div>
            <div style={{ fontSize: "1.6em", fontWeight: 800, marginTop: "2px" }}>{score.toFixed(0)}%</div>
          </div>
          <div style={{ fontSize: "0.88em", opacity: 0.8, textAlign: "right" }}>{statusDetail}</div>
        </div>
        <div className="db-freshness-meter">
          <div className={`db-freshness-fill ${freshness.status}`} style={{ width: `${score}%` }} />
        </div>
        <div style={{ fontSize: "0.88em", opacity: 0.84 }}>{suggestion}</div>
        <div className="db-freshness-meta">
          <div className="db-freshness-meta-card">
            <div className="db-freshness-meta-label">Current Session Actions</div>
            <div className="db-freshness-meta-value">{freshness.actionCount}</div>
          </div>
          <div className="db-freshness-meta-card">
            <div className="db-freshness-meta-label">Latest Refresh ROI</div>
            <div className="db-freshness-meta-value">{latestRoi}</div>
          </div>
          <div className="db-freshness-meta-card">
            <div className="db-freshness-meta-label">Recovery Delta</div>
            <div className="db-freshness-meta-value">{latestRecovery}</div>
          </div>
          <div className="db-freshness-meta-card">
            <div className="db-freshness-meta-label">Latest Boundary</div>
            <div className="db-freshness-meta-value" title={latestTimestamp}>
              {trunc(latestEventType, 22)}
            </div>
          </div>
        </div>
      </div>
      <RefreshAnalysisSection refreshAnalysis={refreshAnalysis} />
    </>
  );
}

// ── Refresh ROI Analysis ───────────────────────────────────────────────────

interface RefreshAnalysisSectionProps {
  refreshAnalysis: DashboardPayload["refreshAnalysis"];
}
function RefreshAnalysisSection({ refreshAnalysis }: RefreshAnalysisSectionProps) {
  if (refreshAnalysis.length === 0) return null;

  const roiValues = refreshAnalysis.map((e) => e.refreshRoi).filter((v): v is number => v !== null);
  const avgRoi = roiValues.length > 0 ? roiValues.reduce((s, v) => s + v, 0) / roiValues.length : null;
  const avgRecoveryDelta = refreshAnalysis.reduce((s, e) => s + e.recoveryDelta, 0) / refreshAnalysis.length;
  const bestEntry =
    [...refreshAnalysis].sort((a, b) => (b.refreshRoi ?? -Infinity) - (a.refreshRoi ?? -Infinity))[0] ?? null;
  const latestEntry = refreshAnalysis.at(-1) ?? null;

  const sorted = [...refreshAnalysis].sort(
    (a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime(),
  );

  return (
    <div className="db-refresh-history">
      <h2>🔄 Refresh ROI</h2>
      <div className="stats-grid">
        <div className="stat-card db-highlight">
          <div className="stat-value db-accent">{refreshAnalysis.length}</div>
          <div className="stat-label">Refresh Events</div>
          <div className="stat-detail">compact or truncation boundaries</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${getDeltaClass(avgRoi)}`}>{formatSignedPercent(avgRoi)}</div>
          <div className="stat-label">Average ROI</div>
          <div className="stat-detail">post.trueRate / pre.trueRate - 1</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${getDeltaClass(avgRecoveryDelta)}`}>{formatSignedPoints(avgRecoveryDelta)}</div>
          <div className="stat-label">Average Recovery</div>
          <div className="stat-detail">post true rate minus pre true rate</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${getDeltaClass(bestEntry?.refreshRoi ?? null)}`}>
            {formatSignedPercent(bestEntry?.refreshRoi ?? null)}
          </div>
          <div className="stat-label">Best Refresh</div>
          <div className="stat-detail">{bestEntry?.event.type ?? latestEntry?.event.type ?? "memory"}</div>
        </div>
      </div>
      <div className="db-refresh-note">
        Compares the last 10 turns before and after each refresh boundary. Older VS Code logs without compact or
        truncation signals are hidden automatically.
      </div>
      <table className="db-lang-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Pre True Rate</th>
            <th>Post True Rate</th>
            <th>Recovery Delta</th>
            <th>Refresh ROI</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => {
            const timestamp = new Date(entry.event.timestamp).toLocaleString();
            return (
              <tr key={i}>
                <td>{timestamp}</td>
                <td>{entry.event.type}</td>
                <td>{entry.preTurns.trueRate.toFixed(1)}%</td>
                <td>{entry.postTurns.trueRate.toFixed(1)}%</td>
                <td className={getDeltaClass(entry.recoveryDelta)}>{formatSignedPoints(entry.recoveryDelta)}</td>
                <td className={getDeltaClass(entry.refreshRoi)}>{formatSignedPercent(entry.refreshRoi)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────

function InsightsSection({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;
  return (
    <>
      <h2>💡 Insights</h2>
      <div className="insights-section">
        {insights.map((text, i) => (
          <div key={i} className={`insight-card${getInsightClass(text)}`}>
            <span className="insight-icon" />
            {text}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Weekly Trend ──────────────────────────────────────────────────────────

function WeeklyTrendSection({ weeklyTrend }: { weeklyTrend: DashboardPayload["weeklyTrend"] }) {
  if (!weeklyTrend || (weeklyTrend.thisWeek.shown === 0 && weeklyTrend.lastWeek.shown === 0)) return null;

  const thisRateStr = weeklyTrend.thisWeek.shown > 0 ? `${weeklyTrend.thisWeek.rate.toFixed(1)}%` : "—";
  const lastRateStr = weeklyTrend.lastWeek.shown > 0 ? `${weeklyTrend.lastWeek.rate.toFixed(1)}%` : "—";

  let diffEl: React.ReactNode = null;
  if (weeklyTrend.thisWeek.shown > 0 && weeklyTrend.lastWeek.shown > 0) {
    const sign = weeklyTrend.rateDiff > 0 ? "+" : "";
    const cssClass = weeklyTrend.rateDiff > 0 ? "trend-up" : weeklyTrend.rateDiff < 0 ? "trend-down" : "trend-neutral";
    const arrow = weeklyTrend.rateDiff > 0 ? "↑" : weeklyTrend.rateDiff < 0 ? "↓" : "→";
    diffEl = (
      <div className={`trend-diff ${cssClass}`}>
        {arrow} {sign}
        {weeklyTrend.rateDiff.toFixed(1)}%
      </div>
    );
  }

  return (
    <>
      <h2>📈 Weekly Trend</h2>
      <div className="trend-container">
        <div className="trend-card">
          <h3>Last Week</h3>
          <div className="trend-stat">
            <span>Shown</span>
            <span>{weeklyTrend.lastWeek.shown}</span>
          </div>
          <div className="trend-stat">
            <span>Accepted</span>
            <span>{weeklyTrend.lastWeek.accepted}</span>
          </div>
          <div className="trend-stat">
            <span>Rate</span>
            <span>{lastRateStr}</span>
          </div>
          <div className="trend-stat">
            <span>Chat</span>
            <span>{weeklyTrend.lastWeek.chat}</span>
          </div>
        </div>
        <div className="trend-card">
          <h3>This Week</h3>
          <div className="trend-stat">
            <span>Shown</span>
            <span>{weeklyTrend.thisWeek.shown}</span>
          </div>
          <div className="trend-stat">
            <span>Accepted</span>
            <span>{weeklyTrend.thisWeek.accepted}</span>
          </div>
          <div className="trend-stat">
            <span>Rate</span>
            <span>{thisRateStr}</span>
          </div>
          <div className="trend-stat">
            <span>Chat</span>
            <span>{weeklyTrend.thisWeek.chat}</span>
          </div>
          {diffEl}
        </div>
      </div>
    </>
  );
}

// ── Agent Intelligence Overview ───────────────────────────────────────────

function AgentIntelligenceSection({ agenticStats }: { agenticStats: DashboardPayload["agenticStats"] }) {
  const overview: AgentIntelligenceOverview = agenticStats.agentIntelligenceOverview;
  const ratioStr = agenticStats.agenticRatio.toFixed(1);
  const avgStr = overview.avgCallsPerLoop > 0 ? overview.avgCallsPerLoop.toFixed(1) : "—";
  const completionStr = overview.completionRate > 0 ? `${overview.completionRate.toFixed(1)}%` : "—";
  const planSuccessStr = overview.planCount > 0 ? `${overview.planSuccessRate.toFixed(1)}%` : "—";

  const { browserTools, pluginOrSkills, memoryManagement, agentDebug } = agenticStats.featureSignals;
  const featureCards = [
    { label: "Browser Tools", total: browserTools.total, detail: browserTools.breakdown },
    { label: "Plugins / Skills", total: pluginOrSkills.total, detail: pluginOrSkills.breakdown },
    { label: "Session Memory / Compact", total: memoryManagement.total, detail: memoryManagement.breakdown },
    { label: "Agent Debug", total: agentDebug.total, detail: agentDebug.breakdown },
  ];
  const hasFeatureSignals = featureCards.some((c) => c.total > 0);

  return (
    <>
      <hr className="db-section-sep" />
      <h2>🤖 Agent Intelligence Overview</h2>
      <div className="stats-grid">
        <div className="stat-card db-highlight">
          <div className="stat-value db-accent">{overview.autonomousActionCount}</div>
          <div className="stat-label">Autonomous Actions</div>
          <div className="stat-detail">All agentic activity</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{ratioStr}%</div>
          <div className="stat-label">Agentic Ratio</div>
          <div className="stat-detail">of all requests</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{overview.agenticLoopCount}</div>
          <div className="stat-label">Agentic Loops</div>
          <div className="stat-detail">completed episodes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgStr}</div>
          <div className="stat-label">Avg Calls / Loop</div>
          <div className="stat-detail">agentic depth</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{completionStr}</div>
          <div className="stat-label">Completion Rate</div>
          <div className="stat-detail">episodes completed</div>
        </div>
        {agenticStats.autonomousDurationMs > 0 && (
          <div className="stat-card">
            <div className="stat-value">{formatDuration(agenticStats.autonomousDurationMs)}</div>
            <div className="stat-label">Autonomous Duration</div>
            <div className="stat-detail">total active time</div>
          </div>
        )}
      </div>

      {overview.autonomousRatioByModel.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.9em", margin: "16px 0 6px", opacity: 0.8 }}>Autonomous Ratio by Model</h3>
          <table className="db-lang-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Autonomous / Total</th>
                <th>Ratio</th>
                <th>Avg sec / Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.autonomousRatioByModel.map((m) => (
                <tr key={m.model}>
                  <td>{trunc(m.model, 30)}</td>
                  <td>
                    {m.subagentCount} / {m.totalCount}
                  </td>
                  <td>{m.ratio.toFixed(1)}%</td>
                  <td>{m.velocitySecondsPerAction > 0 ? `${m.velocitySecondsPerAction.toFixed(1)}s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {hasFeatureSignals && (
        <>
          <hr className="db-section-sep" />
          <h3 style={{ fontSize: "1em", margin: "16px 0 10px" }}>🧪 VS Code 1.110 Feature Signals</h3>
          <div className="stats-grid">
            {featureCards.map((card) => {
              const top = card.detail
                .slice(0, 2)
                .map((e) => `${e.name} (${e.count})`)
                .join(" · ");
              return (
                <div key={card.label} className="stat-card">
                  <div className="stat-value">{card.total}</div>
                  <div className="stat-label">{card.label}</div>
                  <div className="stat-detail">{top || "detected log signals"}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {overview.planCount > 0 && (
        <>
          <hr className="db-section-sep" />
          <h3 style={{ fontSize: "1em", margin: "16px 0 10px" }}>📋 Planning &amp; Execution</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{overview.planCount}</div>
              <div className="stat-label">Plans Proposed</div>
              <div className="stat-detail">agent/plan proposals</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{overview.executedPlanCount}</div>
              <div className="stat-label">Plans Executed</div>
              <div className="stat-detail">led to file edits</div>
            </div>
            <div className="stat-card db-highlight">
              <div className="stat-value db-accent">{planSuccessStr}</div>
              <div className="stat-label">Success Rate</div>
              <div className="stat-detail">plans implemented</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{overview.userChoicesInPlan}</div>
              <div className="stat-label">User Choices</div>
              <div className="stat-detail">in-plan interactions</div>
            </div>
          </div>
        </>
      )}

      {overview.autonomousRatioByModel.length > 0 && (
        <>
          <div style={{ marginTop: "16px" }}>
            <ModelDepthVelocityChart data={overview.autonomousRatioByModel} />
          </div>
          <div style={{ marginTop: "4px" }}>
            <AgenticEfficiencyScatterPlot data={overview.autonomousRatioByModel} />
          </div>
        </>
      )}
    </>
  );
}
