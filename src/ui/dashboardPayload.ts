/**
 * Builds the `DashboardPayload` sent from the extension host to the WebView.
 *
 * Extracted as a standalone function so that it can be unit-tested without
 * requiring a VS Code process.
 */

import { mergeCountByNormalizedModel, mergeStatsByNormalizedModel } from "../log/logContentParser";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import { calculateWeeklyAgenticDepthTrend, calculateWeeklyTrend } from "../metrics/weeklyTrend";
import type { AgenticDepthStat, CopilotUsageStats, RefreshAnalysis, SessionStat, SessionSummary } from "../types";
import type {
  AgentIntelligenceOverview,
  AgenticFeatureSignals,
  AgenticStats,
  ContextFreshness,
  CountBreakdownEntry,
  DashboardPayload,
  EvolutionPoint,
  SummaryData,
  TimelineEntry,
  VelocityPoint,
  WeeklyTrendData,
} from "./dashboardMessages";

/** Average characters per accepted completion (used for ROI estimation). */
const AVG_CHARS_PER_COMPLETION = 40;

/** Estimated developer typing speed in chars/min (used for ROI estimation). */
const TYPING_SPEED_CPM = 200;

/**
 * Cognitive weight applied to autonomous AI duration when calculating agentic ROI.
 * A value of 0.5 represents the 50% of autonomous time credited as developer time saved,
 * acknowledging that developers still need to monitor and review AI actions.
 * Intended to be made user-configurable in a future settings panel.
 */
const AGENTIC_COGNITIVE_WEIGHT = 0.5;

/** Number of history days used to compute the anomaly-detection baseline. */
const ANOMALY_BASELINE_DAYS = 14;

/** Minimum number of suggestions shown on a day for it to be included in baseline / detection. */
const MIN_SHOWN_FOR_ANOMALY = 10;

/** z-score magnitude above which a data point is considered an anomaly. */
const ANOMALY_Z_THRESHOLD = 2;

function toSortedBreakdown(source: Map<string, number>): CountBreakdownEntry[] {
  return Array.from(source.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildFallbackSessionSummaries(stats: CopilotUsageStats): SessionSummary[] {
  return Array.from(stats.bySession.values())
    .map((session) => {
      const trueRate = session.shown > 0 ? (session.accepted / session.shown) * 100 : 0;
      const totalActions = session.shown + session.accepted + session.chat + session.errors;
      const dateMatch = session.sessionId.match(/(\d{4})(\d{2})(\d{2})/);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : session.sessionId;
      return {
        sessionId: session.sessionId,
        title: date !== session.sessionId ? date : session.sessionId,
        date,
        totalActions,
        trueRate,
        autonomousDuration: 0,
        efficiencyScore: trueRate,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.totalActions - a.totalActions);
}

/**
 * Convert raw Copilot stats + optional advanced-metrics into the data shape
 * consumed by the dashboard WebView.
 */
export function buildDashboardPayload(
  stats: CopilotUsageStats,
  trueAcceptance?: TrueAcceptanceResult,
  velocity?: VelocityAnalysisResult,
  modelPerformance?: ModelPerformanceResult,
  refreshAnalysis: RefreshAnalysis[] = [],
  sessionSummaries: SessionSummary[] = [],
): DashboardPayload {
  const titledSessionSummaries = sessionSummaries.filter((session) => Boolean(session.title?.trim()));
  const effectiveSessionSummaries =
    sessionSummaries.length > 0
      ? titledSessionSummaries
      : buildFallbackSessionSummaries(stats).filter((session) => Boolean(session.title?.trim()));

  // ── Summary ──────────────────────────────────────────────────────────────
  const typingMinutesSaved = (stats.totalAccepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
  // Agentic contribution: AGENTIC_COGNITIVE_WEIGHT of autonomous duration represents developer time freed up.
  const agenticMinutesSaved = (stats.autonomousDurationMs / 60000) * AGENTIC_COGNITIVE_WEIGHT;
  const estimatedMinutesSaved = typingMinutesSaved + agenticMinutesSaved;
  const trueAcceptanceRate = trueAcceptance?.trueRate ?? null;

  // Best model = the model name that appears most often as "best" across
  // all languages in the cross-tabulation.
  let bestModel: string | null = null;
  if (modelPerformance && modelPerformance.bestModelByLanguage.size > 0) {
    const freq = new Map<string, number>();
    for (const model of modelPerformance.bestModelByLanguage.values()) {
      freq.set(model, (freq.get(model) ?? 0) + 1);
    }
    bestModel = [...freq.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }

  const summary: SummaryData = {
    totalShown: stats.totalShown,
    totalAccepted: stats.totalAccepted,
    acceptanceRate: stats.acceptanceRate,
    trueAcceptanceRate,
    estimatedMinutesSaved,
    typingMinutesSaved,
    agenticMinutesSaved,
    bestModel,
  };

  // ── Timeline ─────────────────────────────────────────────────────────────
  const dateEntries = Array.from(stats.byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // ── Available range ───────────────────────────────────────────────────────
  const allDates = Array.from(stats.byDate.keys()).sort();
  const availableRange = {
    minDate: allDates[0] ?? "",
    maxDate: allDates[allDates.length - 1] ?? "",
  };

  // ── Anomaly baseline ──────────────────────────────────────────────────────
  // Compute mean and stdDev of daily acceptance rates from the last
  // ANOMALY_BASELINE_DAYS qualifying days (shown >= MIN_SHOWN_FOR_ANOMALY).
  const baselineRates = Array.from(stats.byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([, stat]) => stat.shown >= MIN_SHOWN_FOR_ANOMALY)
    .slice(-ANOMALY_BASELINE_DAYS)
    .map(([, stat]) => (stat.accepted / stat.shown) * 100);

  let baselineMean = 0;
  let baselineStdDev = 0;
  if (baselineRates.length >= 2) {
    baselineMean = baselineRates.reduce((s, v) => s + v, 0) / baselineRates.length;
    const variance = baselineRates.reduce((s, v) => s + (v - baselineMean) ** 2, 0) / baselineRates.length;
    baselineStdDev = Math.sqrt(variance);
  }

  const canDetectAnomalies = baselineRates.length >= 2 && baselineStdDev > 0;

  const timeline: TimelineEntry[] = dateEntries.map(([date, stat]) => {
    const rate = stat.shown > 0 ? (stat.accepted / stat.shown) * 100 : 0;
    let isAnomaly = false;
    let anomalyReason: string | null = null;

    if (canDetectAnomalies && stat.shown >= MIN_SHOWN_FOR_ANOMALY) {
      const zScore = (rate - baselineMean) / baselineStdDev;
      if (Math.abs(zScore) > ANOMALY_Z_THRESHOLD) {
        isAnomaly = true;
        const direction = zScore < 0 ? "lower" : "higher";
        const pctDiff = Math.abs(rate - baselineMean).toFixed(1);
        anomalyReason = `Acceptance rate is ${pctDiff}% ${direction} than usual (z-score: ${zScore.toFixed(2)}). Check model changes or environment configuration.`;
      }
    }

    return {
      date,
      shown: stat.shown,
      accepted: stat.accepted,
      trueAccepted: null, // Per-day true-accept breakdown not available from event data
      rate,
      isAnomaly,
      anomalyReason,
    };
  });

  // ── Velocity / Flow correlation ───────────────────────────────────────────
  const velocityPoints: VelocityPoint[] = (velocity?.timeSeries ?? []).map((dp) => ({
    kpm: dp.kpm,
    completionsAccepted: dp.completionsAccepted,
    flowDisrupted: dp.flowDisrupted,
    windowStart: dp.windowStart,
  }));

  const evolutionData: EvolutionPoint[] = Array.from(stats.byDateAgenticDepth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dayStat]) => ({
      date,
      avgDepth: Number(dayStat.avgLoopActions.toFixed(2)),
      totalDurationMin: Number(((dayStat.velocityMsPerAction * countCompletedActions(dayStat)) / 60000).toFixed(2)),
      completionRate: Number(dayStat.completionRate.toFixed(2)),
    }));

  // ── Weekly trend ─────────────────────────────────────────────────────────
  const trendResult = calculateWeeklyTrend(stats.byDate, stats.chatByDate);
  const agenticTrendResult = calculateWeeklyAgenticDepthTrend(stats.byDateAgenticDepth);
  const weeklyTrend: WeeklyTrendData | null =
    trendResult.thisWeek.shown > 0 || trendResult.lastWeek.shown > 0 ? trendResult : null;

  // ── Insights ─────────────────────────────────────────────────────────────
  const insights: string[] = [];

  // 1. Weekly rate trend
  if (trendResult.thisWeek.shown > 0 && trendResult.lastWeek.shown > 0) {
    const diff = trendResult.rateDiff;
    if (diff > 0) {
      insights.push(
        `📈 This week's acceptance rate is +${diff.toFixed(1)}% higher than last week (${trendResult.thisWeek.rate.toFixed(1)}% vs ${trendResult.lastWeek.rate.toFixed(1)}%).`,
      );
    } else if (diff < 0) {
      insights.push(
        `📉 This week's acceptance rate is ${diff.toFixed(1)}% lower than last week (${trendResult.thisWeek.rate.toFixed(1)}% vs ${trendResult.lastWeek.rate.toFixed(1)}%).`,
      );
    }
  }

  if (
    agenticTrendResult.thisWeek.completedLoops > 0 &&
    agenticTrendResult.lastWeek.completedLoops > 0 &&
    agenticTrendResult.depthGrowthRate >= 0.2
  ) {
    insights.push("🤖 AI is handling more complex tasks (+20% avg. depth vs last week)");
  }

  // 2. Peak hour
  if (stats.byHour.size > 0) {
    const peakEntry = Array.from(stats.byHour.entries()).reduce((a, b) => (b[1] > a[1] ? b : a));
    insights.push(`⏰ Most active hour: ${peakEntry[0]}:00 with ${peakEntry[1]} completions.`);
  }

  // 3. Chat vs inline ratio
  if (stats.totalChat > 0 && stats.totalShown > 0) {
    const ratio = ((stats.totalChat / (stats.totalChat + stats.totalShown)) * 100).toFixed(1);
    insights.push(`💬 Chat usage ratio: ${ratio}% of all Copilot interactions are chat requests.`);
  }

  if (refreshAnalysis.length > 0) {
    const positiveRoi = refreshAnalysis.filter((entry) => (entry.refreshRoi ?? 0) > 0);
    if (positiveRoi.length > 0) {
      const averageRoi = positiveRoi.reduce((sum, entry) => sum + (entry.refreshRoi ?? 0), 0) / positiveRoi.length;
      insights.push(
        `🧼 Refresh ROI average: +${(averageRoi * 100).toFixed(1)}% true-rate recovery after context refreshes.`,
      );
    }
  }

  // ── Agentic stats ─────────────────────────────────────────────────────────
  const toolUsageStats = Array.from(stats.toolUsageStats.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  // ── Agent Intelligence Overview ───────────────────────────────────────────
  // Semantic mapping: all fine-grained subagent intents → "Autonomous Action"
  const autonomousActionCount = stats.subagentRequests;
  const agenticLoopCount = stats.subagentLoops;
  const avgCallsPerLoop = agenticLoopCount > 0 ? autonomousActionCount / agenticLoopCount : 0;

  // Per-model autonomous ratio: only include models that have at least one subagent call.
  // Normalize and merge map entries so that different deployment aliases of the same model
  // are aggregated into a single row.
  const normalizedChatModel = mergeCountByNormalizedModel(stats.byChatModel);
  const normalizedSubagentByModel = mergeCountByNormalizedModel(stats.subagentByModel);
  const normalizedDurationByModel = mergeCountByNormalizedModel(stats.autonomousDurationByModel);
  const normalizedInlineByModel = mergeStatsByNormalizedModel(stats.byModel);

  const autonomousRatioByModel: AgentIntelligenceOverview["autonomousRatioByModel"] = [];
  for (const [model, totalCount] of normalizedChatModel) {
    const subagentCount = normalizedSubagentByModel.get(model) ?? 0;
    if (subagentCount === 0) {
      continue;
    }
    const ratio = totalCount > 0 ? (subagentCount / totalCount) * 100 : 0;
    const durationMs = normalizedDurationByModel.get(model) ?? 0;
    const velocitySecondsPerAction = subagentCount > 0 && durationMs > 0 ? durationMs / 1000 / subagentCount : 0;
    const depthStat = stats.agenticDepthByModel.get(model);
    const avgLoopActions = depthStat?.avgLoopActions ?? 0;
    const modelCompletionRate = depthStat?.completionRate ?? 0;
    const inlineStat = normalizedInlineByModel.get(model) ?? { shown: 0, accepted: 0 };
    const modelAcceptanceRate = inlineStat.shown > 0 ? (inlineStat.accepted / inlineStat.shown) * 100 : 0;
    const modelTotalAccepted = inlineStat.accepted;
    const modelTypingMinutesSaved = (modelTotalAccepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
    const modelAgenticMinutesSaved = (durationMs / 60000) * AGENTIC_COGNITIVE_WEIGHT;
    autonomousRatioByModel.push({
      model,
      subagentCount,
      totalCount,
      ratio,
      velocitySecondsPerAction,
      avgLoopActions,
      completionRate: modelCompletionRate,
      autonomousDurationMs: durationMs,
      acceptanceRate: modelAcceptanceRate,
      totalTimeSaved: modelTypingMinutesSaved + modelAgenticMinutesSaved,
      totalAccepted: modelTotalAccepted,
    });
  }
  autonomousRatioByModel.sort((a, b) => b.ratio - a.ratio);

  const agentIntelligenceOverview: AgentIntelligenceOverview = {
    autonomousActionCount,
    agenticLoopCount,
    avgCallsPerLoop,
    completionRate: stats.completionRate,
    planCount: stats.planCount,
    executedPlanCount: stats.executedPlanCount,
    planSuccessRate: stats.planCount > 0 ? (stats.executedPlanCount / stats.planCount) * 100 : 0,
    userChoicesInPlan: stats.userChoicesInPlan,
    autonomousRatioByModel,
  };

  const featureSignals: AgenticFeatureSignals = {
    browserTools: {
      total: stats.browserToolInvocations,
      breakdown: toSortedBreakdown(stats.browserToolsByType),
    },
    pluginOrSkills: {
      total: stats.pluginOrSkillInvocations,
      breakdown: toSortedBreakdown(stats.pluginOrSkillByName),
    },
    memoryManagement: {
      total: stats.memoryManagementEvents.length,
      breakdown: toSortedBreakdown(stats.memoryManagementByType),
    },
    agentDebug: {
      total: stats.agentDebugEvents,
      breakdown: toSortedBreakdown(stats.agentDebugByType),
    },
  };

  const agenticStats: AgenticStats = {
    subagentRequests: stats.subagentRequests,
    agenticRatio: stats.agenticRatio,
    autonomousDurationMs: stats.autonomousDurationMs,
    toolUsageStats,
    agentIntelligenceOverview,
    featureSignals,
  };

  const freshness = calculateContextFreshness(stats, trueAcceptanceRate, refreshAnalysis);

  return {
    days: timeline.length,
    availableRange,
    summary,
    timeline,
    velocityPoints,
    evolutionData,
    insights,
    weeklyTrend,
    agenticStats,
    refreshAnalysis,
    freshness,
    sessionSummaries: effectiveSessionSummaries,
  };
}

function getLatestSession(stats: CopilotUsageStats): SessionStat | null {
  const latestEntry = Array.from(stats.bySession.entries()).sort((a, b) => b[0].localeCompare(a[0]))[0];
  return latestEntry?.[1] ?? null;
}

function calculateContextFreshness(
  stats: CopilotUsageStats,
  trueAcceptanceRate: number | null,
  refreshAnalysis: RefreshAnalysis[],
): ContextFreshness | null {
  if (refreshAnalysis.length === 0) {
    return null;
  }

  const latestSession = getLatestSession(stats);
  if (!latestSession) {
    return null;
  }

  const actionCount = latestSession.shown + latestSession.accepted + latestSession.chat + latestSession.errors;
  const latestRefresh = refreshAnalysis.at(-1) ?? null;
  if (actionCount <= 50) {
    return {
      score: 100,
      actionCount,
      status: "fresh",
      actionPenalty: 0,
      trendPenalty: 0,
      suggestedAction: "none",
      latestRefreshRoi: latestRefresh?.refreshRoi ?? null,
      latestRecoveryDelta: latestRefresh?.recoveryDelta ?? null,
    };
  }

  const overflow = actionCount - 50;
  const actionPenalty = Math.min(overflow * 1.15, 60);
  const effectiveTrueRate = trueAcceptanceRate ?? stats.acceptanceRate;
  const fatigueRatio =
    stats.acceptanceRate > 0 ? Math.max(0, (stats.acceptanceRate - effectiveTrueRate) / stats.acceptanceRate) : 0;
  const positiveRoi = refreshAnalysis.filter((entry) => (entry.refreshRoi ?? 0) > 0);
  const averagePositiveRoi =
    positiveRoi.length > 0
      ? positiveRoi.reduce((sum, entry) => sum + (entry.refreshRoi ?? 0), 0) / positiveRoi.length
      : 0;
  const trendPenalty = Math.min(fatigueRatio * 25 + averagePositiveRoi * 20, 30);
  const score = Math.max(0, Math.min(100, 100 - actionPenalty - trendPenalty));
  const status = score >= 70 ? "fresh" : score >= 40 ? "aging" : "exhausted";
  const suggestedAction = status === "fresh" ? "none" : status === "aging" ? "compact" : "restart";

  return {
    score,
    actionCount,
    status,
    actionPenalty,
    trendPenalty,
    suggestedAction,
    latestRefreshRoi: latestRefresh?.refreshRoi ?? null,
    latestRecoveryDelta: latestRefresh?.recoveryDelta ?? null,
  };
}

function countCompletedActions(stat: AgenticDepthStat): number {
  const completedLoops =
    stat.loopDistribution.bucket1 +
    stat.loopDistribution.bucket2 +
    stat.loopDistribution.bucket3to5 +
    stat.loopDistribution.bucket6to10 +
    stat.loopDistribution.bucket11plus;
  return completedLoops * stat.avgLoopActions;
}
