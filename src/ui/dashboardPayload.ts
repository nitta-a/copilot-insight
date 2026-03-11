/**
 * Builds the `DashboardPayload` sent from the extension host to the WebView.
 *
 * Extracted as a standalone function so that it can be unit-tested without
 * requiring a VS Code process.
 */

import { calculateWeeklyTrend } from "../metrics/weeklyTrend";
import type { CopilotUsageStats, SessionStat } from "../types";
import type { DashboardPayload, SessionEntry, TimelineEntry } from "./dashboardMessages";

/** Average characters per accepted completion (used for ROI estimation). */
const AVG_CHARS_PER_COMPLETION = 40;

/** Estimated developer typing speed in chars/min (used for ROI estimation). */
const TYPING_SPEED_CPM = 200;

/**
 * Cognitive weight applied to autonomous AI duration when calculating agentic ROI.
 * A value of 0.5 represents the 50% of autonomous time credited as developer time saved.
 */
const AGENTIC_COGNITIVE_WEIGHT = 0.5;

/** Compute per-session estimated minutes saved from inline completions. */
function sessionMinSaved(session: SessionStat): number {
  return (session.accepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
}

/** Derive an ISO date string from a session ID (format: …YYYYMMDD…) or fall back to the ID itself. */
function sessionDate(sessionId: string): string {
  const m = sessionId.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : sessionId;
}

/**
 * Convert raw Copilot stats into the core data shape consumed by the dashboard WebView.
 *
 * Division-by-zero is guarded: `acceptanceRate` is 0 when `totalShown` is 0,
 * and per-day rates in `timeline` default to 0 when `shown` is 0.
 */
export function buildDashboardPayload(stats: CopilotUsageStats): DashboardPayload {
  // ── ROI ─────────────────────────────────────────────────────────────────
  const typingMinutesSaved = (stats.totalAccepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
  const agenticMinutesSaved = (stats.autonomousDurationMs / 60000) * AGENTIC_COGNITIVE_WEIGHT;
  const estimatedTimeSaved = typingMinutesSaved + agenticMinutesSaved;

  // ── Acceptance rate (zero-division guarded) ──────────────────────────────
  const acceptanceRate = stats.totalShown > 0 ? (stats.totalAccepted / stats.totalShown) * 100 : 0;

  // ── Timeline ─────────────────────────────────────────────────────────────
  const timeline: TimelineEntry[] = Array.from(stats.byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, stat]) => ({
      date,
      shown: stat.shown,
      accepted: stat.accepted,
      rate: stat.shown > 0 ? (stat.accepted / stat.shown) * 100 : 0,
    }));

  // ── Session summary list ──────────────────────────────────────────────────
  const sessions: SessionEntry[] = Array.from(stats.bySession.values())
    .map((session) => ({
      sessionId: session.sessionId,
      date: sessionDate(session.sessionId),
      accepted: session.accepted,
      estimatedMinSaved: sessionMinSaved(session),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.accepted - a.accepted);

  // ── Insights ─────────────────────────────────────────────────────────────
  const insights: string[] = buildInsights(stats);

  return {
    totalShown: stats.totalShown,
    totalAccepted: stats.totalAccepted,
    acceptanceRate,
    estimatedTimeSaved,
    activeSessions: stats.bySession.size,
    timeline,
    sessions,
    insights,
  };
}

/** Exported constants so that callers (e.g. report generator) can reuse the same ROI formula. */
export const ROI_AVG_CHARS_PER_COMPLETION = AVG_CHARS_PER_COMPLETION;
export const ROI_TYPING_SPEED_CPM = TYPING_SPEED_CPM;
export const ROI_AGENTIC_COGNITIVE_WEIGHT = AGENTIC_COGNITIVE_WEIGHT;

function buildInsights(stats: CopilotUsageStats): string[] {
  const insights: string[] = [];

  // 1. Weekly rate trend
  const trendResult = calculateWeeklyTrend(stats.byDate, stats.chatByDate);
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

  return insights;
}
