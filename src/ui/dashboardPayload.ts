/**
 * Builds the `DashboardPayload` sent from the extension host to the WebView.
 *
 * Extracted as a standalone function so that it can be unit-tested without
 * requiring a VS Code process.
 */

import * as path from "node:path";
import { addUsage } from "../log/cliLogReader";
import { extractTopKeywords } from "../log/keywordExtractor";
import { mergeCountByNormalizedModel } from "../log/logContentParser";
import { calculateWeeklyTrend } from "../metrics/weeklyTrend";
import type {
  CliUsageStat,
  CopilotUsageStats,
  SessionDetailPayload,
  SessionStat,
  SessionSummary,
  UsageStatCount,
} from "../types";
import { PROMPT_LENGTH_BUCKETS } from "../types";
import { toAiCredits } from "../utils";
import type {
  AgenticFeatureSignals,
  AgenticStats,
  CountBreakdownEntry,
  DashboardPayload,
  PromptInsightsData,
  SessionsData,
  SummaryData,
  TimelineEntry,
  TurnBucket,
  WeeklyTrendData,
} from "./dashboardMessages";

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

/**
 * Build the token consumption summary from accumulated stats.
 * Returns `null` when no log entries reported token-count fields.
 */
function buildTokenStats(stats: CopilotUsageStats): SummaryData["tokenStats"] {
  const total = stats.totalPromptTokens + stats.totalCompletionTokens;
  if (total === 0) {
    return null;
  }

  const totalRequests = stats.totalShown + stats.totalChat;
  const avgPromptTokensPerRequest =
    totalRequests > 0 && stats.totalPromptTokens > 0 ? Math.round(stats.totalPromptTokens / totalRequests) : 0;

  const topModelsByTokens = Array.from(stats.tokensByModel.entries())
    .map(([model, { promptTokens, completionTokens }]) => ({ model, promptTokens, completionTokens }))
    .sort((a, b) => b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens))
    .slice(0, 5);

  return {
    totalPromptTokens: stats.totalPromptTokens,
    totalCompletionTokens: stats.totalCompletionTokens,
    totalTokens: total,
    avgPromptTokensPerRequest,
    topModelsByTokens,
  };
}

function buildCliUsageStats(stats: CopilotUsageStats): SummaryData["cliUsageStats"] {
  const usage = stats.cliUsage;
  if (!usage) {
    return null;
  }

  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (
    totalTokens === 0 &&
    usage.totalNanoAiu === 0 &&
    !stats.cliThreads?.length &&
    !Array.from(stats.cliByDate.values()).some((day) => day.usage)
  ) {
    return null;
  }

  const topModels = Array.from(stats.cliUsageByModel ?? [])
    .map(([model, modelUsage]) => ({
      model,
      totalTokens: modelUsage.inputTokens + modelUsage.outputTokens,
      aiCredits: toAiCredits(modelUsage.totalNanoAiu),
    }))
    .sort((a, b) => (b.aiCredits ?? -1) - (a.aiCredits ?? -1) || b.totalTokens - a.totalTokens)
    .slice(0, 5);
  const dailyUsage = Array.from(stats.cliByDate.entries())
    .flatMap(([date, stat]) =>
      stat.usage
        ? [
            {
              date,
              inputTokens: stat.usage.inputTokens,
              outputTokens: stat.usage.outputTokens,
              totalTokens: stat.usage.inputTokens + stat.usage.outputTokens,
              aiCredits: toAiCredits(stat.usage.totalNanoAiu),
            },
          ]
        : [],
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailyNanoAiu = Array.from(stats.cliByDate.values()).reduce<number | null>((sum, day) => {
    if (!day.usage) {
      return sum;
    }
    return sum === null || day.usage.totalNanoAiu === null ? null : sum + day.usage.totalNanoAiu;
  }, 0);

  const threads = stats.cliThreads;
  const projects = new Map<string | null, CliUsageStat>();
  const projectDailyUsage = new Map<string | null, Map<string, CliUsageStat>>();
  for (const thread of threads ?? []) {
    const projectPath = thread.projectPath ?? null;
    projects.set(projectPath, addUsage(projects.get(projectPath), thread.usage));
    const daily = projectDailyUsage.get(projectPath) ?? new Map<string, CliUsageStat>();
    for (const entry of thread.usageByDate ?? []) {
      daily.set(entry.date, addUsage(daily.get(entry.date), entry.usage));
    }
    projectDailyUsage.set(projectPath, daily);
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens,
    totalAiCredits: toAiCredits(usage.totalNanoAiu),
    topModels,
    projects:
      !threads ||
      (threads.length === 0 && (totalTokens > 0 || usage.totalNanoAiu !== 0)) ||
      threads.some((thread) => thread.projectPath === undefined)
        ? null
        : Array.from(projects, ([projectPath, projectUsage]) => ({
            path: projectPath,
            name: projectPath ? path.basename(projectPath) || projectPath : "Unknown",
            inputTokens: projectUsage.inputTokens,
            outputTokens: projectUsage.outputTokens,
            cacheReadTokens: projectUsage.cacheReadTokens,
            cacheWriteTokens: projectUsage.cacheWriteTokens,
            aiCredits: toAiCredits(projectUsage.totalNanoAiu),
            dailyUsage: Array.from(projectDailyUsage.get(projectPath) ?? [], ([date, dailyUsage]) => ({
              date,
              usage: dailyUsage,
            })),
          })).sort(
            (a, b) => b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens || a.name.localeCompare(b.name),
          ),
    projectDailyUsageAvailable: !!threads && threads.every((thread) => thread.usageByDate !== undefined),
    dailyUsage,
    fusionRuns: (threads ?? []).flatMap((thread) => thread.fusionRuns ?? []),
    modelCalls: (threads ?? []).flatMap((thread) => thread.diagnostics?.modelCalls ?? []),
    interventionThreads: (threads ?? []).map(({ projectPath, interventions }) => ({ projectPath, interventions })),
    unattributedTokens: totalTokens - dailyUsage.reduce((sum, day) => sum + day.totalTokens, 0),
    unattributedAiCredits:
      usage.totalNanoAiu === null || dailyNanoAiu === null ? null : (usage.totalNanoAiu - dailyNanoAiu) / 1e9,
  };
}

function buildFallbackSessionSummaries(stats: CopilotUsageStats): SessionSummary[] {
  return Array.from(stats.bySession.values())
    .map((session) => {
      const { sessionId, accepted, shown, chat, errors } = session;
      const totalActions = shown + accepted + chat + errors;
      const dateMatch = sessionId.match(/(\d{4})(\d{2})(\d{2})/);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : sessionId;
      return {
        sessionId,
        title: date !== sessionId ? date : sessionId,
        date,
        totalActions,
        autonomousDuration: 0,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.totalActions - a.totalActions);
}

function findTopCountModel(byModel: Map<string, number>): { model: string | null; count: number } {
  let topModel: string | null = null;
  let topCount = 0;

  for (const [model, count] of byModel) {
    if (count <= 0) {
      continue;
    }
    if (count > topCount || (count === topCount && topModel !== null && model.localeCompare(topModel) < 0)) {
      topModel = model;
      topCount = count;
    }
  }

  return { model: topModel, count: topCount };
}

/**
 * Convert raw Copilot stats + optional advanced-metrics into the data shape
 * consumed by the dashboard WebView.
 *
 */
export function buildDashboardPayload(stats: CopilotUsageStats, hasMoreData = false): DashboardPayload {
  // ── Summary ──────────────────────────────────────────────────────────────

  // Normalize and merge model maps early so we can use them consistently across
  // summary KPIs and the per-model autonomous ratio table below.
  const normalizedChatModelForSummary = mergeCountByNormalizedModel(stats.byChatModel);
  const topChatModel = findTopCountModel(normalizedChatModelForSummary);

  const summary: SummaryData = {
    totalShown: stats.totalShown,
    totalAccepted: stats.totalAccepted,
    acceptanceRate: stats.acceptanceRate,
    topChatModel: topChatModel.model,
    topChatModelCount: topChatModel.count,
    totalSessions: stats.bySession.size,
    tokenStats: buildTokenStats(stats),
    cliUsageStats: buildCliUsageStats(stats),
  };

  // ── Timeline ─────────────────────────────────────────────────────────────
  const allDates = Array.from(
    new Set([...stats.byDate.keys(), ...stats.chatByDate.keys(), ...stats.cliByDate.keys()]),
  ).sort();
  const dateEntries = allDates.map((date) => [date, stats.byDate.get(date) ?? { shown: 0, accepted: 0 }] as const);

  // ── Available range ───────────────────────────────────────────────────────
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
      rate: stat.shown > 0 ? rate : null,
      isAnomaly,
      anomalyReason,
      // Source-category breakdown: when sourceCategory data is not available, all
      // values fall back to "editor" (backward compat with older log formats).
      editorShown: stat.shown,
      editorAccepted: stat.accepted,
      chatCount: stats.chatByDate.get(date) ?? 0,
      cliPrompts: stats.cliByDate.get(date)?.prompts ?? 0,
    };
  });

  // ── Weekly trend ─────────────────────────────────────────────────────────
  const trendResult = calculateWeeklyTrend(stats.byDate, stats.chatByDate);
  const weeklyTrend: WeeklyTrendData | null =
    trendResult.thisWeek.shown > 0 || trendResult.lastWeek.shown > 0 ? trendResult : null;

  // ── Insights ─────────────────────────────────────────────────────────────
  const insights: string[] = [];

  // 1. Weekly rate trend
  if (trendResult.thisWeek.shown > 0 && trendResult.lastWeek.shown > 0) {
    const { rateDiff, thisWeek, lastWeek } = trendResult;
    if (rateDiff !== 0) {
      const thisWeekRate = thisWeek.rate.toFixed(1);
      const lastWeekRate = lastWeek.rate.toFixed(1);
      const diff = rateDiff.toFixed(1);
      const rate = rateDiff > 0 ? `rate is +${diff}% higher` : `rate is ${diff}% lower`;
      insights.push(`📈 This week's acceptance ${rate} than last week (${thisWeekRate}% vs ${lastWeekRate}%).`);
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
  const cliToolExecutions = Array.from((stats.cliToolExecutions ?? new Map()).entries())
    .map(([name, counts]) => ({
      name,
      total: counts.total,
      success: counts.success,
      fail: counts.fail,
      successRate: counts.total > 0 ? (counts.success / counts.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total || b.successRate - a.successRate || a.name.localeCompare(b.name));
  const totalCliAgentTypes = Array.from((stats.cliAgentTypes ?? new Map()).values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  const cliAgentTypes = Array.from((stats.cliAgentTypes ?? new Map()).entries())
    .map(([name, count]) => ({
      name,
      count,
      share: totalCliAgentTypes > 0 ? (count / totalCliAgentTypes) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

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
    autonomousDurationMs: stats.autonomousDurationMs,
    toolUsageStats,
    cliToolExecutions,
    cliAgentTypes,
    featureSignals,
  };

  return {
    days: timeline.length,
    availableRange,
    summary,
    timeline,
    insights,
    weeklyTrend,
    agenticStats,
    hasMoreData,
  };
}

/**
 * Aggregate saved chat sessions into four request-count buckets.
 *
 * Buckets: 1, 2–3, 4–5, and 6+ requests.
 */
function buildTurnStats(stats: CopilotUsageStats): TurnBucket[] {
  const buckets: TurnBucket[] = [
    { bucket: "1 request", sessionCount: 0 },
    { bucket: "2-3 requests", sessionCount: 0 },
    { bucket: "4-5 requests", sessionCount: 0 },
    { bucket: "6+ requests", sessionCount: 0 },
  ];

  for (const session of stats.chatSessions ?? []) {
    const requestCount = session.requests.length;
    if (requestCount === 0) {
      continue;
    }
    const b = (() => {
      if (requestCount === 1) {
        return buckets[0];
      } else if (requestCount <= 3) {
        return buckets[1];
      } else if (requestCount <= 5) {
        return buckets[2];
      }
      return buckets[3];
    })();
    b.sessionCount++;
  }

  return buckets;
}

function getLatestSession(stats: CopilotUsageStats): SessionStat | null {
  const latestEntry = Array.from(stats.bySession.entries()).sort((a, b) => b[0].localeCompare(a[0]))[0];
  return latestEntry?.[1] ?? null;
}

/**
 * Convert `promptEffectiveness` bucket counts into Chart.js bubble-chart data points.
 * - x: bucket midpoint (character count)
 * - y: observed response rate (0–100)
 * - r: bubble radius proportional to the square root of shown count (min 4 px)
 */
function buildPromptLengthScatterData(
  promptEffectiveness: Record<string, { shown: number; accepted: number }>,
): { x: number; y: number; r: number }[] {
  const points: { x: number; y: number; r: number }[] = [];
  for (const bucket of PROMPT_LENGTH_BUCKETS) {
    const counts = promptEffectiveness[bucket.key];
    if (!counts || counts.shown === 0) {
      continue;
    }
    const y = (counts.accepted / counts.shown) * 100;
    const r = Math.max(4, Math.round(Math.sqrt(counts.shown) * 3));
    points.push({ x: bucket.midpoint, y: Math.round(y * 10) / 10, r });
  }
  return points;
}

/**
 * Build the lazy-loaded Prompt Insights payload.
 * Called on demand when the WebView requests "promptInsights" tab data.
 */
export function buildPromptInsightsPayload(stats: CopilotUsageStats): PromptInsightsData {
  const keywordTexts: string[] = [];
  for (const record of stats.chatSessionTitles ?? []) {
    if (record.title) {
      keywordTexts.push(record.title);
    }
    if (record.firstRequestText) {
      keywordTexts.push(record.firstRequestText);
    }
  }
  for (const session of stats.chatSessions ?? []) {
    if (session.title) {
      keywordTexts.push(session.title);
    }
    if (session.firstRequestText) {
      keywordTexts.push(session.firstRequestText);
    }
    for (const req of session.requests) {
      if (req.messageText) {
        keywordTexts.push(req.messageText);
      }
    }
  }
  const topKeywords = extractTopKeywords(keywordTexts, 20);

  return {
    chatIntentBreakdown: toSortedBreakdown(stats.byChatIntent),
    commandUsageBreakdown: toSortedBreakdown(stats.commandUsage),
    finishReasonBreakdown: toSortedBreakdown(stats.finishReasonCounts),
    promptLengthScatterData: buildPromptLengthScatterData(stats.promptEffectiveness),
    topKeywords,
    turnStats: buildTurnStats(stats),
  };
}

/**
 * Build the lazy-loaded Sessions payload.
 * Called on demand when the WebView requests "sessions" tab data.
 */
export function buildSessionsPayload(stats: CopilotUsageStats, sessionSummaries: SessionSummary[] = []): SessionsData {
  const effectiveSessionSummaries =
    sessionSummaries.length > 0
      ? sessionSummaries.map((session) => ({
          ...session,
          title: session.title?.trim() ? session.title : session.date || session.sessionId,
        }))
      : buildFallbackSessionSummaries(stats).filter((session) => Boolean(session.title?.trim()));

  const cliSummaries: SessionSummary[] = (stats.cliThreads ?? []).map((thread) => ({
    sessionId: `cli:${thread.sessionId}`,
    title: thread.title,
    date: (thread.startedAt ?? thread.lastActivityAt ?? "").slice(0, 10),
    totalActions: thread.prompts,
    autonomousDuration: 0,
  }));
  return {
    sessionSummaries: [...effectiveSessionSummaries, ...cliSummaries].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function buildCliSessionDetail(stats: CopilotUsageStats, sessionId: string): SessionDetailPayload | null {
  const thread = stats.cliThreads?.find((entry) => `cli:${entry.sessionId}` === sessionId);
  if (!thread) {
    return null;
  }
  return {
    sessionId,
    date: (thread.startedAt ?? "").slice(0, 10),
    totalActions: thread.prompts,
    autonomousDuration: 0,
    timeline: [],
    episodes: [],
    fatigueMarker: null,
    threads: [
      {
        threadId: sessionId,
        title: thread.title,
        startedAt: thread.startedAt ?? "",
        autonomousDurationMs: 0,
        acceptedChars: 0,
        hasAutonomousRun: false,
        stepCount: thread.prompts,
        longestPauseMs: 0,
        hasSelectableTitle: true,
        usage: thread.usage,
        usageSource: "cli",
        fusionRuns: thread.fusionRuns,
        interventions: thread.interventions,
        diagnostics: thread.diagnostics,
        agentHostChildChats: thread.agentHostChildChats,
        agentHostChats: thread.agentHostChats,
      },
    ],
    stepsByThread: {
      [sessionId]: thread.turns.map((turn) => ({
        timestamp: turn.timestamp ?? "",
        actor: turn.actor ?? "human",
        phase: turn.actor === "ai" ? "execution" : "human",
        label: "Prompt",
        detail: turn.prompt || "(No prompt preview)",
        rawIntent: "Copilot CLI",
        usage: turn.usage,
      })),
    },
  };
}
