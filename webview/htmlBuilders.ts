/**
 * HTML builder functions — pure functions that receive data and return HTML
 * strings.  They have no side effects, do not touch the DOM, and do not manage
 * any application state.  DOM assignment is the responsibility of the calling
 * render functions in `dashboard.ts`.
 */

import type { AgentStep, SessionDetailPayload, SessionThreadSummary } from "../src/types";
import type {
  AgentIntelligenceOverview,
  ContextFreshness,
  DashboardPayload,
  WeeklyTrendData,
} from "../src/ui/dashboardMessages";
import {
  actorBadgeClass,
  actorIcon,
  actorLabel,
  agentStepBadgeClass,
  escHtml,
  formatDuration,
  formatPause,
  formatPhaseLabel,
  formatSignedPercent,
  formatSignedPoints,
  formatStepDetail,
  getDeltaClass,
  getInsightClass,
  trunc,
} from "./dashboardUtils";

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

export function buildSummaryCardsHtml(summary: DashboardPayload["summary"]): string {
  const trueRateStr = summary.trueAcceptanceRate !== null ? `${summary.trueAcceptanceRate.toFixed(1)}%` : "—";
  const totalHours = (summary.estimatedMinutesSaved / 60).toFixed(1);
  const typingHours = (summary.typingMinutesSaved / 60).toFixed(1);
  const agenticHours = (summary.agenticMinutesSaved / 60).toFixed(1);
  const roiDetail =
    summary.agenticMinutesSaved > 0 ? `Typing: ${typingHours}h + AI: ${agenticHours}h` : `Typing: ${typingHours}h`;
  const topChatModelStr = summary.topChatModel ?? "—";
  const topChatModelDetail =
    summary.topChatModel && summary.topChatModelCount > 0
      ? `${summary.topChatModelCount} requests`
      : "no chat model data";
  const topAskModelStr = summary.topAskModel ?? "—";
  const topAskModelDetail =
    summary.topAskModel && summary.topAskModelCount > 0 ? `${summary.topAskModelCount} requests` : "no ask model data";
  const topPlanModelStr = summary.topPlanModel ?? "—";
  const topPlanModelDetail =
    summary.topPlanModel && summary.topPlanModelCount > 0
      ? `${summary.topPlanModelCount} model-tagged proposals`
      : "no model-tagged plan data";

  return `
    <div class="stat-card db-highlight">
      <div class="stat-value db-accent">${trueRateStr}</div>
      <div class="stat-label">True Acceptance Rate</div>
      <div class="stat-detail">vs ${summary.acceptanceRate.toFixed(1)}% raw</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-accent">${totalHours} hours</div>
      <div class="stat-label">Estimated Time Saved</div>
      <div class="stat-detail">${roiDetail}</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-model" title="${escHtml(topChatModelStr)}">${escHtml(trunc(topChatModelStr, 18))}</div>
      <div class="stat-label">Top Chat Model</div>
      <div class="stat-detail">${escHtml(topChatModelDetail)}</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-model" title="${escHtml(topAskModelStr)}">${escHtml(trunc(topAskModelStr, 18))}</div>
      <div class="stat-label">Top Ask Model</div>
      <div class="stat-detail">${escHtml(topAskModelDetail)}</div>
    </div>
    <div class="stat-card db-highlight">
      <div class="stat-value db-model" title="${escHtml(topPlanModelStr)}">${escHtml(trunc(topPlanModelStr, 18))}</div>
      <div class="stat-label">Top Plan Model</div>
      <div class="stat-detail">${escHtml(topPlanModelDetail)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.totalShown}</div>
      <div class="stat-label">Suggestions Shown</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.totalAccepted}</div>
      <div class="stat-label">Suggestions Accepted</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.acceptanceRate.toFixed(1)}%</div>
      <div class="stat-label">Raw Acceptance Rate</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export function buildInsightsHtml(insights: string[]): string {
  if (insights.length === 0) {
    return "";
  }
  const cards = insights
    .map((text) => {
      const cls = getInsightClass(text);
      return `<div class="insight-card${cls}"><span class="insight-icon"></span>${escHtml(text)}</div>`;
    })
    .join("\n");
  return `<h2>💡 Insights</h2>\n<div class="insights-section">${cards}</div>`;
}

// ---------------------------------------------------------------------------
// Context Freshness
// ---------------------------------------------------------------------------

export function buildContextFreshnessHtml(
  freshness: ContextFreshness | null,
  refreshAnalysis: DashboardPayload["refreshAnalysis"],
): string {
  if (!freshness || refreshAnalysis.length === 0) {
    return "";
  }

  const latestRefresh = refreshAnalysis.at(-1) ?? null;
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
  const latestEventType = latestRefresh ? latestRefresh.event.type : "memory";
  const latestTimestamp = latestRefresh ? new Date(latestRefresh.event.timestamp).toLocaleString() : "";

  return `
    <h2>🧠 Context Freshness</h2>
    <div class="db-freshness-card">
      <div class="db-freshness-header">
        <div>
          <div class="db-freshness-status">${escHtml(statusLabel)}</div>
          <div style="font-size:1.6em;font-weight:800;margin-top:2px">${score.toFixed(0)}%</div>
        </div>
        <div style="font-size:0.88em;opacity:0.8;text-align:right">${escHtml(statusDetail)}</div>
      </div>
      <div class="db-freshness-meter">
        <div class="db-freshness-fill ${freshness.status}" style="width:${score}%"></div>
      </div>
      <div style="font-size:0.88em;opacity:0.84">${escHtml(suggestion)}</div>
      <div class="db-freshness-meta">
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Current Session Actions</div>
          <div class="db-freshness-meta-value">${freshness.actionCount}</div>
        </div>
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Latest Refresh ROI</div>
          <div class="db-freshness-meta-value">${escHtml(latestRoi)}</div>
        </div>
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Recovery Delta</div>
          <div class="db-freshness-meta-value">${escHtml(latestRecovery)}</div>
        </div>
        <div class="db-freshness-meta-card">
          <div class="db-freshness-meta-label">Latest Boundary</div>
          <div class="db-freshness-meta-value" title="${escHtml(latestTimestamp)}">${escHtml(trunc(latestEventType, 22))}</div>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Refresh ROI analysis
// ---------------------------------------------------------------------------

export function buildRefreshAnalysisHtml(refreshAnalysis: DashboardPayload["refreshAnalysis"]): string {
  if (refreshAnalysis.length === 0) {
    return "";
  }

  const roiValues = refreshAnalysis.map((entry) => entry.refreshRoi).filter((value): value is number => value !== null);
  const avgRoi = roiValues.length > 0 ? roiValues.reduce((sum, value) => sum + value, 0) / roiValues.length : null;
  const avgRecoveryDelta =
    refreshAnalysis.reduce((sum, entry) => sum + entry.recoveryDelta, 0) / refreshAnalysis.length;
  const bestEntry =
    [...refreshAnalysis].sort((a, b) => (b.refreshRoi ?? -Infinity) - (a.refreshRoi ?? -Infinity))[0] ?? null;
  const latestEntry = refreshAnalysis.at(-1) ?? null;

  const rows = [...refreshAnalysis]
    .sort((a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime())
    .map((entry) => {
      const timestamp = new Date(entry.event.timestamp).toLocaleString();
      const recoveryClass = getDeltaClass(entry.recoveryDelta);
      const roiClass = getDeltaClass(entry.refreshRoi);
      return `<tr>
        <td>${escHtml(timestamp)}</td>
        <td>${escHtml(entry.event.type)}</td>
        <td>${entry.preTurns.trueRate.toFixed(1)}%</td>
        <td>${entry.postTurns.trueRate.toFixed(1)}%</td>
        <td class="${recoveryClass}">${escHtml(formatSignedPoints(entry.recoveryDelta))}</td>
        <td class="${roiClass}">${escHtml(formatSignedPercent(entry.refreshRoi))}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="db-refresh-history">
      <h2>🔄 Refresh ROI</h2>
      <div class="stats-grid">
        <div class="stat-card db-highlight">
          <div class="stat-value db-accent">${refreshAnalysis.length}</div>
          <div class="stat-label">Refresh Events</div>
          <div class="stat-detail">compact or truncation boundaries</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${getDeltaClass(avgRoi)}">${escHtml(formatSignedPercent(avgRoi))}</div>
          <div class="stat-label">Average ROI</div>
          <div class="stat-detail">post.trueRate / pre.trueRate - 1</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${getDeltaClass(avgRecoveryDelta)}">${escHtml(formatSignedPoints(avgRecoveryDelta))}</div>
          <div class="stat-label">Average Recovery</div>
          <div class="stat-detail">post true rate minus pre true rate</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${getDeltaClass(bestEntry?.refreshRoi ?? null)}">${escHtml(formatSignedPercent(bestEntry?.refreshRoi ?? null))}</div>
          <div class="stat-label">Best Refresh</div>
          <div class="stat-detail">${escHtml(bestEntry?.event.type ?? latestEntry?.event.type ?? "memory")}</div>
        </div>
      </div>
      <div class="db-refresh-note">Compares the last 10 turns before and after each refresh boundary. Older VS Code logs without compact or truncation signals are hidden automatically.</div>
      <table class="db-lang-table">
        <tr><th>Time</th><th>Event</th><th>Pre True Rate</th><th>Post True Rate</th><th>Recovery Delta</th><th>Refresh ROI</th></tr>
        ${rows}
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Weekly trend
// ---------------------------------------------------------------------------

export function buildWeeklyTrendHtml(trend: WeeklyTrendData | null): string {
  if (!trend || (trend.thisWeek.shown === 0 && trend.lastWeek.shown === 0)) {
    return "";
  }

  const thisRateStr = trend.thisWeek.shown > 0 ? `${trend.thisWeek.rate.toFixed(1)}%` : "—";
  const lastRateStr = trend.lastWeek.shown > 0 ? `${trend.lastWeek.rate.toFixed(1)}%` : "—";

  let diffHtml = "";
  if (trend.thisWeek.shown > 0 && trend.lastWeek.shown > 0) {
    const sign = trend.rateDiff > 0 ? "+" : "";
    const cssClass = trend.rateDiff > 0 ? "trend-up" : trend.rateDiff < 0 ? "trend-down" : "trend-neutral";
    const arrow = trend.rateDiff > 0 ? "↑" : trend.rateDiff < 0 ? "↓" : "→";
    diffHtml = `<div class="trend-diff ${cssClass}">${arrow} ${sign}${trend.rateDiff.toFixed(1)}%</div>`;
  }

  return `<h2>📈 Weekly Trend</h2>
<div class="trend-container">
  <div class="trend-card">
    <h3>Last Week</h3>
    <div class="trend-stat"><span>Shown</span><span>${trend.lastWeek.shown}</span></div>
    <div class="trend-stat"><span>Accepted</span><span>${trend.lastWeek.accepted}</span></div>
    <div class="trend-stat"><span>Rate</span><span>${lastRateStr}</span></div>
    <div class="trend-stat"><span>Chat</span><span>${trend.lastWeek.chat}</span></div>
  </div>
  <div class="trend-card">
    <h3>This Week</h3>
    <div class="trend-stat"><span>Shown</span><span>${trend.thisWeek.shown}</span></div>
    <div class="trend-stat"><span>Accepted</span><span>${trend.thisWeek.accepted}</span></div>
    <div class="trend-stat"><span>Rate</span><span>${thisRateStr}</span></div>
    <div class="trend-stat"><span>Chat</span><span>${trend.thisWeek.chat}</span></div>
    ${diffHtml}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Agent Intelligence Overview (HTML portion only; React mounts stay in dashboard.ts)
// ---------------------------------------------------------------------------

export function buildAgentIntelligenceOverviewHtml(agenticStats: DashboardPayload["agenticStats"]): string {
  const overview: AgentIntelligenceOverview = agenticStats.agentIntelligenceOverview;
  const ratioStr = agenticStats.agenticRatio.toFixed(1);
  const avgStr = overview.avgCallsPerLoop > 0 ? overview.avgCallsPerLoop.toFixed(1) : "—";
  const completionStr = overview.completionRate > 0 ? `${overview.completionRate.toFixed(1)}%` : "—";
  const durationCell =
    agenticStats.autonomousDurationMs > 0
      ? `<div class="stat-card"><div class="stat-value">${escHtml(formatDuration(agenticStats.autonomousDurationMs))}</div><div class="stat-label">Autonomous Duration</div><div class="stat-detail">total active time</div></div>`
      : "";

  const planSuccessStr = overview.planCount > 0 ? `${overview.planSuccessRate.toFixed(1)}%` : "—";
  const planningSection =
    overview.planCount > 0
      ? `<hr class="db-section-sep">
       <h3 style="font-size:1em;margin:16px 0 10px">📋 Planning &amp; Execution</h3>
       <div class="stats-grid">
         <div class="stat-card">
           <div class="stat-value">${overview.planCount}</div>
           <div class="stat-label">Plans Proposed</div>
           <div class="stat-detail">agent/plan proposals</div>
         </div>
         <div class="stat-card">
           <div class="stat-value">${overview.executedPlanCount}</div>
           <div class="stat-label">Plans Executed</div>
           <div class="stat-detail">led to file edits</div>
         </div>
         <div class="stat-card db-highlight">
           <div class="stat-value db-accent">${planSuccessStr}</div>
           <div class="stat-label">Success Rate</div>
           <div class="stat-detail">plans implemented</div>
         </div>
         <div class="stat-card">
           <div class="stat-value">${overview.userChoicesInPlan}</div>
           <div class="stat-label">User Choices</div>
           <div class="stat-detail">in-plan interactions</div>
         </div>
       </div>`
      : "";

  const modelRows = overview.autonomousRatioByModel
    .map(({ model, subagentCount, totalCount, ratio, velocitySecondsPerAction }) => {
      const velocityStr = velocitySecondsPerAction > 0 ? `${velocitySecondsPerAction.toFixed(1)}s` : "—";
      return `<tr>
          <td>${escHtml(trunc(model, 30))}</td>
          <td>${subagentCount} / ${totalCount}</td>
          <td>${ratio.toFixed(1)}%</td>
          <td>${velocityStr}</td>
        </tr>`;
    })
    .join("");

  const modelTable = modelRows
    ? `<h3 style="font-size:0.9em;margin:16px 0 6px;opacity:0.8">Autonomous Ratio by Model</h3>
       <table class="db-lang-table">
         <tr><th>Model</th><th>Autonomous / Total</th><th>Ratio</th><th>Avg sec / Action</th></tr>
         ${modelRows}
       </table>`
    : "";

  const featureCards = [
    {
      label: "Browser Tools",
      total: agenticStats.featureSignals.browserTools.total,
      detail: agenticStats.featureSignals.browserTools.breakdown,
    },
    {
      label: "Plugins / Skills",
      total: agenticStats.featureSignals.pluginOrSkills.total,
      detail: agenticStats.featureSignals.pluginOrSkills.breakdown,
    },
    {
      label: "Session Memory / Compact",
      total: agenticStats.featureSignals.memoryManagement.total,
      detail: agenticStats.featureSignals.memoryManagement.breakdown,
    },
    {
      label: "Agent Debug",
      total: agenticStats.featureSignals.agentDebug.total,
      detail: agenticStats.featureSignals.agentDebug.breakdown,
    },
  ];
  const hasFeatureSignals = featureCards.some((card) => card.total > 0);
  const featureSection = hasFeatureSignals
    ? `<hr class="db-section-sep">
       <h3 style="font-size:1em;margin:16px 0 10px">🧪 VS Code 1.110 Feature Signals</h3>
       <div class="stats-grid">
         ${featureCards
           .map((card) => {
             const top = card.detail
               .slice(0, 2)
               .map((entry) => `${escHtml(entry.name)} (${entry.count})`)
               .join(" · ");
             return `<div class="stat-card">
               <div class="stat-value">${card.total}</div>
               <div class="stat-label">${escHtml(card.label)}</div>
               <div class="stat-detail">${top || "detected log signals"}</div>
             </div>`;
           })
           .join("")}
       </div>`
    : "";

  return `
    <hr class="db-section-sep">
    <h2>🤖 Agent Intelligence Overview</h2>
    <div class="stats-grid">
      <div class="stat-card db-highlight">
        <div class="stat-value db-accent">${overview.autonomousActionCount}</div>
        <div class="stat-label">Autonomous Actions</div>
        <div class="stat-detail">All agentic activity</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${ratioStr}%</div>
        <div class="stat-label">Agentic Ratio</div>
        <div class="stat-detail">of all requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${overview.agenticLoopCount}</div>
        <div class="stat-label">Agentic Loops</div>
        <div class="stat-detail">completed episodes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgStr}</div>
        <div class="stat-label">Avg Calls / Loop</div>
        <div class="stat-detail">agentic depth</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${completionStr}</div>
        <div class="stat-label">Completion Rate</div>
        <div class="stat-detail">episodes completed</div>
      </div>
      ${durationCell}
    </div>
    ${modelTable}
    ${featureSection}
    ${planningSection}
    <div id="db-model-depth-chart" style="margin-top:16px"></div>
    <div id="db-agentic-scatter" style="margin-top:4px"></div>`;
}

// ---------------------------------------------------------------------------
// Thread detail
// ---------------------------------------------------------------------------

/** Sort and filter threads to those with activity, newest first. */
export function getSelectableThreadsSorted(
  threads: SessionDetailPayload["threads"],
): SessionDetailPayload["threads"] {
  return [...threads].filter((t) => t.stepCount > 0).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Render the step timeline for a selected thread. Returns an HTML string. */
export function buildSelectedThreadHtml(detail: SessionDetailPayload, selectedThreadId: string): string {
  const sortedThreads = getSelectableThreadsSorted(detail.threads);
  const selectedThread =
    sortedThreads.find((thread) => thread.threadId === selectedThreadId) ?? sortedThreads[0] ?? null;
  if (!selectedThread) {
    return '<div class="db-empty-panel">No thread detail with activity is available.</div>';
  }
  const steps = detail.stepsByThread[selectedThread.threadId] ?? [];
  const longestPause = steps.reduce((max, step) => Math.max(max, step.durationMs ?? 0), 0);
  const stepsHtml =
    steps.length > 0
      ? steps
          .map((step: AgentStep) => {
            const pause = step.durationMs ?? 0;
            const isLongest = pause > 0 && pause === longestPause;
            const durationChip =
              step.durationMs !== undefined
                ? `<span class="db-agent-step-chip db-agent-step-chip-duration${isLongest ? " longest" : ""}">⏱ ${escHtml(formatPause(step.durationMs))}</span>`
                : '<span class="db-agent-step-chip db-agent-step-chip-duration pending">Current</span>';
            const pauseHtml =
              step.isSignificantPause && step.durationMs !== undefined
                ? '<div class="db-agent-step-separator">(Significant Pause)</div>'
                : "";
            return `<div class="db-agent-step-row${isLongest ? " longest-pause" : ""}${step.isSignificantPause ? " significant-pause" : ""}">
              <div class="db-agent-step-body${step.isFallback ? " fallback" : ""}">
                <div class="db-agent-step-meta">
                  <span>${escHtml(new Date(step.timestamp).toLocaleString())}</span>
                </div>
                <div class="db-agent-step-chip-row">
                  <span class="db-agent-step-chip db-agent-step-chip-actor ${actorBadgeClass(step.actor)}"><span>${actorIcon(step.actor)}</span><span>${escHtml(actorLabel(step.actor))}</span></span>
                  <span class="db-agent-step-badge ${agentStepBadgeClass(step.label)}">${escHtml(step.label)}</span>
                  ${durationChip}
                </div>
                <div class="db-agent-step-detail">${escHtml(formatStepDetail(step.detail, step.label))}</div>
                <div class="db-agent-step-submeta"><span>${escHtml(formatPhaseLabel(step.phase))}</span><span>${escHtml(step.rawIntent || "signal")}</span></div>
                ${isLongest ? '<div class="db-agent-step-duration-note">Longest wait</div>' : ""}
                ${pauseHtml}
              </div>
            </div>`;
          })
          .join("\n")
      : '<div class="db-empty-panel">No timeline signals were recorded for this thread.</div>';
  return `<div class="db-thread-detail-header-block">
      <div><strong>${escHtml(selectedThread.title)}</strong><div style="margin-top:4px;font-size:0.84em;opacity:0.74">${escHtml(new Date(selectedThread.startedAt).toLocaleString())}</div></div>
      <div class="db-thread-detail-metrics">
        <span class="db-thread-chip">${selectedThread.stepCount} steps</span>
        <span class="db-thread-chip">${selectedThread.estimatedMinutesSaved.toFixed(1)} min saved</span>
        ${selectedThread.longestPauseMs > 0 ? `<span class="db-thread-chip">Longest wait ${escHtml(formatPause(selectedThread.longestPauseMs))}</span>` : ""}
        ${selectedThread.hasAutonomousRun ? '<span class="db-thread-chip autonomous">🤖 Autonomous</span>' : ""}
      </div>
    </div>
    <div class="db-agent-step-timeline">${stepsHtml}</div>`;
}

/** Render the list of all thread rows. Returns an HTML string. */
export function buildThreadListHtml(
  flat: Array<{ thread: SessionThreadSummary; sessionId: string }>,
  selectedThreadId: string,
  selectedThreadSessionId: string,
  isBackgroundLoading: boolean,
  sessionLoadQueueLength: number,
): string {
  if (flat.length === 0) {
    return `<div class="db-empty-panel">${isBackgroundLoading || sessionLoadQueueLength > 0 ? "Loading threads\u2026" : "No threads with activity were detected."}</div>`;
  }
  return flat
    .map(({ thread, sessionId }) => {
      const active = thread.threadId === selectedThreadId && sessionId === selectedThreadSessionId ? " active" : "";
      return `<button class="db-thread-row${active}" data-thread-id="${escHtml(thread.threadId)}" data-session-id="${escHtml(sessionId)}">
        <div class="db-thread-row-title">${thread.hasAutonomousRun ? "\uD83E\uDD16 " : ""}${escHtml(thread.title)}</div>
        <div class="db-thread-row-subtext">${escHtml(new Date(thread.startedAt).toLocaleString())}</div>
        <div class="db-thread-row-meta"><span>${thread.stepCount} steps</span><span>${thread.estimatedMinutesSaved.toFixed(1)} min saved</span></div>
      </button>`;
    })
    .join("");
}
