/**
 * Report generator — Phase 3 of the roadmap.
 *
 * Generates Markdown reports summarising Copilot usage for a
 * specific period or project.  The output can be saved to a `.md` file
 * or copied to the clipboard.
 *
 * Report sections:
 * 1. Executive Summary — headline metrics
 * 3. Language Breakdown — per-language stats
 * 4. Model Performance — which model works best
 * 5. Velocity / Flow — KPM analysis
 */

import type { NativeReportInput } from "../log/nativeBridge";
import { generateMarkdownReportNative } from "../log/nativeBridge";
import type { ModelPerformanceResult, VelocityAnalysisResult } from "../metrics/metricsEngine";
import type { CopilotUsageStats } from "../types";
import { toAiCredits } from "../utils";

/** Input options for report generation. */
export interface ReportOptions {
  /** The period covered by the report (e.g. "2026-02-01 — 2026-02-28"). */
  period: string;
  /** Optional project or workspace name. */
  projectName?: string;
  /** Log-parsed stats. */
  stats: CopilotUsageStats;
  /** Velocity analysis result (optional). */
  velocity?: VelocityAnalysisResult;
  /** Model performance cross-tab (optional). */
  modelPerformance?: ModelPerformanceResult;
  /**
   * Auto-generated insight strings from the dashboard (optional).
   * When provided, these are appended verbatim in an "Insights" section.
   */
  insights?: string[];
}

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
 * Build a `NativeReportInput` from the given `ReportOptions`.
 *
 * Converts all `Map`-typed fields in `CopilotUsageStats` to plain
 * `Record<string, number>` objects as expected by the Rust bridge.
 */
function buildNativeReportInput(options: ReportOptions): NativeReportInput {
  const { stats } = options;
  const allDates = Array.from(new Set([...stats.byDate.keys(), ...stats.cliByDate.keys()])).sort();

  return {
    totalShown: stats.totalShown,
    totalAccepted: stats.totalAccepted,
    totalChat: stats.totalChat,
    totalErrors: stats.totalErrors,
    logFilesFound: stats.logFilesFound,
    avgLatencyMs: stats.avgLatencyMs,
    subagentRequests: stats.subagentRequests,
    autonomousDurationMs: stats.autonomousDurationMs,
    browserToolsByType: Object.fromEntries(stats.browserToolsByType),
    pluginOrSkillByName: Object.fromEntries(stats.pluginOrSkillByName),
    memoryManagementCount: stats.memoryManagementEvents.length,
    memoryManagementByType: Object.fromEntries(stats.memoryManagementByType),
    agentDebugEvents: stats.agentDebugEvents,
    agentDebugByType: Object.fromEntries(stats.agentDebugByType),
    minDate: allDates[0] ?? "",
    maxDate: allDates[allDates.length - 1] ?? "",
    projectName: options.projectName ?? "",
    errorsByType: Object.fromEntries(stats.errorsByType),
  };
}

/**
 * Append the optional report sections that require externally-computed metrics
 * (Model Performance, Velocity) and the footer.
 *
 * These sections are always generated in TypeScript regardless of whether the
 * core sections were produced by the native Rust path or the TS fallback path.
 */
function appendOptionalSections(lines: string[], options: ReportOptions): void {
  const { cliUsage, cliUsageByModel } = options.stats;
  if (cliUsage && (cliUsage.inputTokens > 0 || cliUsage.outputTokens > 0 || (cliUsage.totalNanoAiu ?? 0) > 0)) {
    lines.push("## Copilot CLI Token and AI Credit Usage");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Input Tokens | ${cliUsage.inputTokens} |`);
    lines.push(`| Output Tokens | ${cliUsage.outputTokens} |`);
    lines.push(`| Cache Read Tokens | ${cliUsage.cacheReadTokens} |`);
    lines.push(`| Cache Write Tokens | ${cliUsage.cacheWriteTokens} |`);
    lines.push(`| AI Credits | ${toAiCredits(cliUsage.totalNanoAiu)?.toFixed(6) ?? "Unavailable"} |`);
    lines.push("");

    if (cliUsageByModel && cliUsageByModel.size > 0) {
      lines.push("| Model | Input Tokens | Output Tokens | AI Credits |");
      lines.push("|-------|--------------|---------------|------------|");
      for (const [model, usage] of Array.from(cliUsageByModel.entries()).sort(
        (a, b) => (b[1].totalNanoAiu ?? -1) - (a[1].totalNanoAiu ?? -1),
      )) {
        lines.push(
          `| ${model} | ${usage.inputTokens} | ${usage.outputTokens} | ${toAiCredits(usage.totalNanoAiu)?.toFixed(6) ?? "Unavailable"} |`,
        );
      }
      lines.push("");
    }
  }

  if (options.stats.cliThreads?.length) {
    lines.push(
      "## Copilot CLI Thread Totals",
      "",
      "| Thread | Prompts | Tokens | AI Credits |",
      "|--------|---------|--------|------------|",
    );
    for (const thread of options.stats.cliThreads) {
      const title = thread.title
        .replace(/[<>&|`*_[\]\\]/g, (char) => `&#${char.charCodeAt(0)};`)
        .replace(/[\r\n]/g, " ");
      lines.push(
        `| ${title} | ${thread.prompts} | ${thread.usage.inputTokens + thread.usage.outputTokens} | ${toAiCredits(thread.usage.totalNanoAiu)?.toFixed(6) ?? "Unavailable"} |`,
      );
    }
    lines.push("");
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
}

/**
 * Generate a Markdown report from Copilot usage statistics.
 *
 * When the native NAPI-RS addon is available, the core sections (Executive
 * Executive Summary) are produced in Rust for improved
 * performance.  Optional sections that require externally-computed metrics
 * (Model Performance, Velocity, Insights) and the footer
 * are always appended in TypeScript.
 *
 * Falls back to a pure-TypeScript implementation when the native addon has not
 * been built or fails to load.
 */
export function generateMarkdownReport(options: ReportOptions): string {
  const { stats, period } = options;

  // ── Native fast-path ──────────────────────────────────────────────────────
  const nativeInput = buildNativeReportInput(options);
  const nativeCore = generateMarkdownReportNative(nativeInput, period);
  if (nativeCore !== null) {
    // Append the optional TypeScript-only sections and footer.
    const extra: string[] = [];
    appendOptionalSections(extra, options);
    return nativeCore + extra.join("\n");
  }

  // ── TypeScript fallback ───────────────────────────────────────────────────
  const lines: string[] = [];

  // --- Header ---
  // Derive date range from stats.byDate and append to title for easy sharing.
  const allDates = Array.from(new Set([...stats.byDate.keys(), ...stats.cliByDate.keys()])).sort();
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
  if (options.projectName) {
    lines.push(`**Project:** ${options.projectName}`);
  }
  lines.push(`**Period:** ${period}`);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push("");

  // --- 1. Executive Summary ---
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  if (stats.totalShown > 0) {
    lines.push(`| Suggestions Shown (legacy logs) | ${stats.totalShown} |`);
  }
  if (stats.totalShown > 0 || stats.totalAccepted > 0) {
    lines.push(`| Suggestions Accepted (legacy logs) | ${stats.totalAccepted} |`);
  }
  lines.push(`| Acceptance Rate | ${stats.totalShown > 0 ? `${stats.acceptanceRate.toFixed(1)}%` : "Unavailable"} |`);
  lines.push(`| Chat Requests | ${stats.totalChat} |`);
  lines.push(`| Avg Latency | ${stats.avgLatencyMs > 0 ? `${stats.avgLatencyMs.toFixed(0)}ms` : "—"} |`);
  lines.push(`| Errors | ${stats.totalErrors} |`);
  lines.push(`| Log Files Parsed | ${stats.logFilesFound} |`);
  lines.push("");

  if (stats.subagentRequests > 0 || stats.autonomousDurationMs > 0) {
    lines.push("## Legacy Agent Log Activity", "");
    if (stats.subagentRequests > 0) {
      lines.push(`- **Recorded subagent requests**: ${stats.subagentRequests}`);
    }
    if (stats.autonomousDurationMs > 0) {
      lines.push(`- **Recorded elapsed duration**: ${formatDurationMs(stats.autonomousDurationMs)}`);
    }
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
    lines.push("## Observed Events");
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

  appendOptionalSections(lines, options);

  return lines.join("\n");
}
