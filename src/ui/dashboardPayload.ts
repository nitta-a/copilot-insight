/**
 * Builds the `DashboardPayload` sent from the extension host to the WebView.
 *
 * Extracted as a standalone function so that it can be unit-tested without
 * requiring a VS Code process.
 */

import type { CopilotUsageStats } from "../types";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type { DashboardPayload, LanguageEntry, SummaryData, TimelineEntry, VelocityPoint } from "./dashboardMessages";

/** Average characters per accepted completion (used for ROI estimation). */
const AVG_CHARS_PER_COMPLETION = 40;

/** Estimated developer typing speed in chars/min (used for ROI estimation). */
const TYPING_SPEED_CPM = 200;

/** Maximum language rows shown in the language-breakdown table. */
const MAX_LANGUAGE_ROWS = 15;

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

  const timeline: TimelineEntry[] = dateEntries.map(([date, stat]) => ({
    date,
    shown: stat.shown,
    accepted: stat.accepted,
    trueAccepted: null, // Per-day true-accept breakdown not available from event data
    rate: stat.shown > 0 ? (stat.accepted / stat.shown) * 100 : 0,
  }));

  // ── Velocity / Flow correlation ───────────────────────────────────────────
  const velocityPoints: VelocityPoint[] = (velocity?.timeSeries ?? []).map((dp) => ({
    kpm: dp.kpm,
    completionsAccepted: dp.completionsAccepted,
    flowDisrupted: dp.flowDisrupted,
    windowStart: dp.windowStart,
  }));

  // ── Language breakdown ────────────────────────────────────────────────────
  const languageBreakdown: LanguageEntry[] = Array.from(stats.byLanguage.entries())
    .sort((a, b) => b[1].shown - a[1].shown)
    .slice(0, MAX_LANGUAGE_ROWS)
    .map(([language, stat]) => ({
      language,
      shown: stat.shown,
      accepted: stat.accepted,
      rate: stat.shown > 0 ? (stat.accepted / stat.shown) * 100 : 0,
    }));

  return { days, summary, timeline, velocityPoints, languageBreakdown };
}
