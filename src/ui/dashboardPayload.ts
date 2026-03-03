/**
 * Builds the `DashboardPayload` sent from the extension host to the WebView.
 *
 * Extracted as a standalone function so that it can be unit-tested without
 * requiring a VS Code process.
 */

import type { CopilotUsageStats } from "../types";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type {
  DashboardPayload,
  SummaryData,
  TimelineEntry,
  VelocityPoint,
  WeeklyTrendData,
  AgenticStats,
} from "./dashboardMessages";
import { calculateWeeklyTrend } from "../metrics/weeklyTrend";

/** Average characters per accepted completion (used for ROI estimation). */
const AVG_CHARS_PER_COMPLETION = 40;

/** Estimated developer typing speed in chars/min (used for ROI estimation). */
const TYPING_SPEED_CPM = 200;

/** Number of history days used to compute the anomaly-detection baseline. */
const ANOMALY_BASELINE_DAYS = 14;

/** Minimum number of suggestions shown on a day for it to be included in baseline / detection. */
const MIN_SHOWN_FOR_ANOMALY = 10;

/** z-score magnitude above which a data point is considered an anomaly. */
const ANOMALY_Z_THRESHOLD = 2;

/**
 * Convert raw Copilot stats + optional advanced-metrics into the data shape
 * consumed by the dashboard WebView.
 */
export function buildDashboardPayload(
  stats: CopilotUsageStats,
  days: number,
  trueAcceptance?: TrueAcceptanceResult,
  velocity?: VelocityAnalysisResult,
  modelPerformance?: ModelPerformanceResult,
): DashboardPayload {
  // ── Summary ──────────────────────────────────────────────────────────────
  const estimatedMinutesSaved = (stats.totalAccepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
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
    bestModel,
  };

  // ── Timeline ─────────────────────────────────────────────────────────────
  const dateEntries = Array.from(stats.byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-days);

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

  // ── Weekly trend ─────────────────────────────────────────────────────────
  const trendResult = calculateWeeklyTrend(stats.byDate, stats.chatByDate);
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

  // ── Agentic stats ─────────────────────────────────────────────────────────
  const toolUsageStats = Array.from(stats.toolUsageStats.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  const agenticStats: AgenticStats = {
    subagentRequests: stats.subagentRequests,
    agenticRatio: stats.agenticRatio,
    autonomousDurationMs: stats.autonomousDurationMs,
    toolUsageStats,
  };

  return { days, summary, timeline, velocityPoints, insights, weeklyTrend, agenticStats };
}
