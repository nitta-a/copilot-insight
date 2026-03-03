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

import type { CopilotUsageStats } from "../types";
import type { TrueAcceptanceResult, VelocityAnalysisResult, ModelPerformanceResult } from "../metrics/metricsEngine";

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
 * Generate a Markdown report from Copilot usage statistics.
 */
export function generateMarkdownReport(options: ReportOptions): string {
  const { stats, period, projectName } = options;
  const lines: string[] = [];

  // --- Header ---
  lines.push("# Copilot Insight — Usage Report");
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

  // --- 2. Acceptance Analysis ---
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

  // --- 3. Model Performance ---
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

  // --- 5. Velocity / Flow ---
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

  // --- 6. ROI Estimation ---
  lines.push("## ROI Estimation");
  lines.push("");
  const estimatedChars = stats.totalAccepted * AVG_CHARS_PER_COMPLETION;
  const estimatedMinutes = estimatedChars / TYPING_SPEED_CPM;
  const estimatedHours = estimatedMinutes / 60;
  lines.push(`- **Estimated Characters Generated:** ${estimatedChars.toLocaleString()}`);
  lines.push(`- **Estimated Time Saved:** ${estimatedMinutes.toFixed(0)} minutes (${estimatedHours.toFixed(1)} hours)`);
  lines.push(
    `- **Calculation:** ${stats.totalAccepted} accepted × ${AVG_CHARS_PER_COMPLETION} avg chars ÷ ${TYPING_SPEED_CPM} chars/min`,
  );
  lines.push("");

  lines.push("---");
  lines.push(
    "*Generated by [Copilot Insight](https://marketplace.visualstudio.com/items?itemName=nitta-a.copilot-insight)*",
  );

  return lines.join("\n");
}
