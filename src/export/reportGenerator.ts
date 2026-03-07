/**
 * Report generator — Phase 3 of the roadmap.
 *
 * Generates Markdown reports summarising Copilot usage and ROI for a
 * specific period or project.  The output can be saved to a `.md` file
 * or copied to the clipboard.
 *
 * Report sections:
 * 1. Executive Summary — headline metrics
 * 2. Acceptance Analysis — raw vs true acceptance rate
 * 3. Language Breakdown — per-language stats
 * 4. Model Performance — which model works best
 * 5. Velocity / Flow — KPM analysis
 * 6. ROI Estimation — estimated time saved
 */

import { mergeCountByNormalizedModel } from "../log/logContentParser";
import type { ModelPerformanceResult, TrueAcceptanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type { CopilotUsageStats } from "../types";

/** Input options for report generation. */
export interface ReportOptions {
  /** The period covered by the report (e.g. "2026-02-01 — 2026-02-28"). */
  period: string;
  /** Optional project or workspace name. */
  projectName?: string;
  /** Log-parsed stats. */
  stats: CopilotUsageStats;
  /** True acceptance rate result (optional). */
  trueAcceptance?: TrueAcceptanceResult;
  /** Velocity analysis result (optional). */
  velocity?: VelocityAnalysisResult;
  /** Model performance cross-tab (optional). */
  modelPerformance?: ModelPerformanceResult;
  /**
   * Auto-generated insight strings from the dashboard (optional).
   * When provided, these are appended verbatim in an "Insights" section.
   */
  insights?: string[];
  /**
   * Pre-computed minutes saved from inline completions (typing speed × accepted chars).
   * When provided, this value is used directly instead of being re-derived from stats,
   * ensuring consistency with the dashboard's `buildDashboardPayload` calculation.
   */
  typingMinutesSaved?: number;
  /**
   * Pre-computed minutes saved from AI autonomous actions (50% of autonomous duration).
   * When provided, this value is used directly, ensuring consistency with the
   * dashboard's `buildDashboardPayload` calculation.  When omitted, the report
   * falls back to computing `(stats.autonomousDurationMs / 60000) * 0.5` so that
   * agentic ROI is never silently lost even when the caller does not supply the
   * pre-computed value.
   */
  agenticMinutesSaved?: number;
}

/**
 * Average characters per completion, used for ROI estimation.
 * Based on empirical analysis of typical Copilot inline suggestions which
 * average approximately 40 characters (one short statement or expression).
 */
const AVG_CHARS_PER_COMPLETION = 40;

/**
 * Estimated typing speed in chars-per-minute for a professional developer.
 * Used to estimate time saved by Copilot completions.
 */
const TYPING_SPEED_CPM = 200;

/**
 * Cognitive weight applied to autonomous AI duration when calculating agentic ROI.
 * Mirrored from `dashboardPayload.ts` to ensure the fallback calculation produces
 * values consistent with the dashboard when `agenticMinutesSaved` is not supplied.
 */
const AGENTIC_COGNITIVE_WEIGHT = 0.5;

/**
 * Format a millisecond duration into a human-readable string (e.g. "2h 5m 30s").
 */
function formatDurationMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

/**
 * Generate a Markdown report from Copilot usage statistics.
 */
export function generateMarkdownReport(options: ReportOptions): string {
  const { stats, period, projectName } = options;
  const lines: string[] = [];

  // --- Header ---
  // Derive date range from stats.byDate and append to title for easy sharing.
  const allDates = Array.from(stats.byDate.keys()).sort();
  const minDate = allDates[0] ?? "";
  const maxDate = allDates[allDates.length - 1] ?? "";
  const dateRangeSuffix =
    minDate && maxDate
      ? minDate === maxDate
        ? ` (${minDate.replace(/-/g, "/")})`
        : ` (${minDate.replace(/-/g, "/")} - ${maxDate.replace(/-/g, "/")})`
      : "";
  lines.push(`# GitHub Copilot Contribution Report${dateRangeSuffix}`);
  lines.push("");
  if (projectName) {
    lines.push(`**Project:** ${projectName}`);
  }
  lines.push(`**Period:** ${period}`);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push("");

  // --- 1. Executive Summary ---
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Suggestions Shown | ${stats.totalShown} |`);
  lines.push(`| Suggestions Accepted | ${stats.totalAccepted} |`);
  lines.push(`| Acceptance Rate | ${stats.acceptanceRate.toFixed(1)}% |`);
  lines.push(`| Chat Requests | ${stats.totalChat} |`);
  lines.push(`| Avg Latency | ${stats.avgLatencyMs > 0 ? `${stats.avgLatencyMs.toFixed(0)}ms` : "—"} |`);
  lines.push(`| Errors | ${stats.totalErrors} |`);
  lines.push(`| Log Files Parsed | ${stats.logFilesFound} |`);
  lines.push("");

  // --- 2. Agentic ROI Summary ---
  if (stats.subagentRequests > 0) {
    lines.push("## Agentic ROI Summary");
    lines.push("");
    lines.push(
      `> 🤖 **AI Autonomous Time: ${formatDurationMs(stats.autonomousDurationMs)}** — time during which Copilot was autonomously acting on your behalf.`,
    );
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Autonomous Duration | ${formatDurationMs(stats.autonomousDurationMs)} |`);
    lines.push(`| Agentic Requests | ${stats.subagentRequests} |`);
    lines.push(`| Agentic Ratio | ${stats.agenticRatio.toFixed(1)}% |`);
    lines.push(`| Episodes Completed | ${stats.subagentLoops} |`);
    lines.push(`| Episodes Started | ${stats.subagentLoopsStarted} |`);
    lines.push(
      `| Episode Completion Rate | ${stats.completionRate > 0 ? `${stats.completionRate.toFixed(1)}%` : "—"} |`,
    );
    lines.push("");
  }

  const featureSections: Array<[string, number, Map<string, number>]> = [
    ["Browser Tools", stats.browserToolInvocations, stats.browserToolsByType],
    ["Plugins / Skills", stats.pluginOrSkillInvocations, stats.pluginOrSkillByName],
    ["Session Memory / Compact", stats.memoryManagementEvents.length, stats.memoryManagementByType],
    ["Agent Debug", stats.agentDebugEvents, stats.agentDebugByType],
  ];
  const hasFeatureSignals = featureSections.some(([, total]) => total > 0);
  if (hasFeatureSignals) {
    lines.push("## VS Code 1.110 Feature Signals");
    lines.push("");
    for (const [title, total, breakdown] of featureSections) {
      if (total === 0) {
        continue;
      }
      lines.push(`### ${title}`);
      lines.push("");
      lines.push(`- **Total Observed Events**: ${total}`);
      for (const [name, count] of Array.from(breakdown.entries()).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )) {
        lines.push(`- **${name}**: ${count}`);
      }
      lines.push("");
    }
  }

  // --- 3. Agent Intelligence Details ---
  if (stats.subagentRequests > 0) {
    const totalLoops = stats.subagentLoops;
    const avgCallsPerLoop = totalLoops > 0 ? stats.subagentRequests / totalLoops : 0;
    lines.push("## Agent Intelligence Details");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Total Autonomous Actions | ${stats.subagentRequests} |`);
    lines.push(`| Completed Agentic Loops | ${stats.subagentLoops} |`);
    lines.push(`| Avg Calls / Loop (Thinking Depth) | ${avgCallsPerLoop > 0 ? avgCallsPerLoop.toFixed(1) : "—"} |`);
    lines.push(
      `| Episode Completion Rate | ${stats.completionRate > 0 ? `${stats.completionRate.toFixed(1)}%` : "—"} |`,
    );
    lines.push("");
  }

  // --- 3a. Planning & Strategic Autonomy ---
  if (stats.planCount > 0) {
    const successRate = (stats.executedPlanCount / stats.planCount) * 100;
    lines.push("## 🧠 Planning & Strategic Autonomy");
    lines.push("");
    lines.push(
      "> AI-proposed plans that were adopted and implemented — a measure of strategic alignment between AI and developer.",
    );
    lines.push("");
    lines.push(`- **Strategic Plans Proposed**: ${stats.planCount}`);
    lines.push(`- **Plans Executed (Implemented)**: ${stats.executedPlanCount}`);
    lines.push(`- **Planning Success Rate**: ${successRate.toFixed(1)}%`);
    lines.push(`- **In-Plan User Interactions**: ${stats.userChoicesInPlan}`);
    lines.push("");
  }

  // --- 4. Model Efficiency ---
  if (stats.subagentByModel.size > 0) {
    lines.push("## Model Efficiency");
    lines.push("");
    lines.push("| Model | Autonomous Actions | Autonomous Ratio | Avg sec / Action |");
    lines.push("|-------|-------------------|--------------------|-----------------|");

    // Normalize model names to aggregate deployment aliases into a single row.
    // We use the normalized duration map for velocity rather than the raw agenticDepthByModel
    // entries (which are keyed by un-normalized names) to keep the data consistent.
    const normalizedSubagent = mergeCountByNormalizedModel(stats.subagentByModel);
    const normalizedDuration = mergeCountByNormalizedModel(stats.autonomousDurationByModel);
    // Normalized total chat counts per model, used to compute the autonomous ratio.
    const normalizedChat = mergeCountByNormalizedModel(stats.byChatModel);

    const modelEntries: Array<{
      model: string;
      subagentCount: number;
      autonomousRatio: number;
      velocitySecondsPerAction: number;
    }> = [];

    for (const [model, subagentCount] of normalizedSubagent) {
      const durationMs = normalizedDuration.get(model) ?? 0;
      // Velocity = total autonomous duration ÷ autonomous action count (simple average).
      const velocitySec = durationMs > 0 && subagentCount > 0 ? durationMs / subagentCount / 1000 : 0;
      // Autonomous ratio = autonomous actions / total chat requests for this model (0–100).
      const totalChatCount = normalizedChat.get(model) ?? 0;
      const autonomousRatio = totalChatCount > 0 ? (subagentCount / totalChatCount) * 100 : 0;
      modelEntries.push({ model, subagentCount, autonomousRatio, velocitySecondsPerAction: velocitySec });
    }

    modelEntries.sort((a, b) => b.subagentCount - a.subagentCount);

    for (const entry of modelEntries.slice(0, 20)) {
      const velocityStr = entry.velocitySecondsPerAction > 0 ? `${entry.velocitySecondsPerAction.toFixed(1)}s` : "—";
      const ratioStr = entry.autonomousRatio > 0 ? `${entry.autonomousRatio.toFixed(1)}%` : "—";
      lines.push(`| ${entry.model} | ${entry.subagentCount} | ${ratioStr} | ${velocityStr} |`);
    }
    lines.push("");
  }

  // --- 5. Acceptance Analysis ---
  if (options.trueAcceptance) {
    const ta = options.trueAcceptance;
    lines.push("## Acceptance Analysis");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Raw Accepted | ${ta.rawAccepted} |`);
    lines.push(`| Raw Rate | ${ta.rawRate.toFixed(1)}% |`);
    lines.push(`| True Accepted (retained) | ${ta.trueAccepted} |`);
    lines.push(`| True Rate | ${ta.trueRate.toFixed(1)}% |`);
    lines.push(`| Reverted Completions | ${ta.revertedCount} |`);
    lines.push("");
    if (ta.revertedCount > 0) {
      const wasteRate = ((ta.revertedCount / ta.rawAccepted) * 100).toFixed(1);
      lines.push(`> ⚠️ ${wasteRate}% of accepted completions were reverted within 30 seconds.`);
      lines.push("");
    }
  }

  // --- 6. Model Performance ---
  if (options.modelPerformance && options.modelPerformance.crossTab.length > 0) {
    const mp = options.modelPerformance;
    lines.push("## Model Performance");
    lines.push("");
    lines.push("| Model | Language | Accepted | Chars | Avg Latency |");
    lines.push("|-------|----------|----------|-------|-------------|");
    for (const entry of mp.crossTab.slice(0, 20)) {
      lines.push(
        `| ${entry.modelName} | ${entry.languageId} | ${entry.totalAccepted} | ${entry.totalCharsAccepted} | ${entry.avgLatencyMs.toFixed(0)}ms |`,
      );
    }
    lines.push("");

    if (mp.bestModelByLanguage.size > 0) {
      lines.push("### Best Model per Language");
      lines.push("");
      for (const [lang, model] of mp.bestModelByLanguage) {
        lines.push(`- **${lang}**: ${model}`);
      }
      lines.push("");
    }
  }

  // --- 7. Velocity / Flow ---
  if (options.velocity) {
    const v = options.velocity;
    lines.push("## Velocity & Flow Analysis");
    lines.push("");
    lines.push(`- **Average KPM:** ${v.averageKpm.toFixed(1)} keystrokes/min`);
    lines.push(
      `- **Flow Disruptions:** ${v.disruptionCount} windows where KPM dropped significantly after a completion`,
    );
    lines.push(`- **Data Points:** ${v.timeSeries.length} 1-minute windows`);
    lines.push("");
    if (v.disruptionCount > 0) {
      lines.push("> 💡 Consider reviewing completion settings if flow disruptions are frequent.");
      lines.push("");
    }
  }

  // --- 8. Productivity Metrics (ROI) ---
  // Use pre-computed values when provided (ensures consistency with the dashboard's
  // buildDashboardPayload calculation).  Fall back to deriving from stats directly.
  const typingMins = options.typingMinutesSaved ?? (stats.totalAccepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
  const agenticMins = options.agenticMinutesSaved ?? (stats.autonomousDurationMs / 60000) * AGENTIC_COGNITIVE_WEIGHT;
  const totalMins = typingMins + agenticMins;
  const totalHours = totalMins / 60;
  const typingHours = typingMins / 60;
  const agenticHours = agenticMins / 60;
  lines.push("## 📊 Productivity Metrics");
  lines.push("");
  lines.push(`- **Total Developer Time Saved**: ${totalHours.toFixed(1)} hours`);
  lines.push(`  - *Coding Assistance*: ${typingHours.toFixed(1)} hours (based on characters accepted)`);
  if (agenticMins > 0) {
    lines.push(`  - *Agentic Autonomy*: ${agenticHours.toFixed(1)} hours (AI-led task execution)`);
  }
  lines.push("");

  // --- 9. Qualitative Insights ---
  if (options.insights && options.insights.length > 0) {
    lines.push("## 💡 Qualitative Insights");
    lines.push("");
    for (const insight of options.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "*Generated by [Copilot Insight](https://marketplace.visualstudio.com/items?itemName=nitta-a.copilot-insight)*",
  );

  return lines.join("\n");
}
