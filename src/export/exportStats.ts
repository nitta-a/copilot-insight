import type { CopilotUsageStats, UsageStatCount, SessionStat } from "../types";
import { toAiCredits } from "../utils";

/** Convert CopilotUsageStats to a CSV string. */
export function exportAsCsv(stats: CopilotUsageStats): string {
  const lines: string[] = [];

  // Summary section
  lines.push("# Summary");
  lines.push("Metric,Value");
  lines.push(`Total Shown,${stats.totalShown}`);
  lines.push(`Total Accepted,${stats.totalAccepted}`);
  lines.push(`Total Rejected,${stats.totalRejected}`);
  lines.push(`Acceptance Rate,${stats.totalShown > 0 ? `${stats.acceptanceRate.toFixed(1)}%` : ""}`);
  lines.push(`Total Chat,${stats.totalChat}`);
  lines.push(`Avg Latency (ms),${stats.avgLatencyMs.toFixed(0)}`);
  lines.push(`Latency P50 (ms),${stats.latencyP50.toFixed(0)}`);
  lines.push(`Latency P95 (ms),${stats.latencyP95.toFixed(0)}`);
  lines.push(`Chat Avg Latency (ms),${stats.chatAvgLatencyMs.toFixed(0)}`);
  lines.push(`Total Errors,${stats.totalErrors}`);
  lines.push(`Log Files Parsed,${stats.logFilesFound}`);
  if (stats.cliUsage) {
    const totalTokens = stats.cliUsage.inputTokens + stats.cliUsage.outputTokens;
    lines.push(`Copilot CLI Input Tokens,${stats.cliUsage.inputTokens}`);
    lines.push(`Copilot CLI Output Tokens,${stats.cliUsage.outputTokens}`);
    lines.push(`Copilot CLI Total Tokens,${totalTokens}`);
    lines.push(`Copilot CLI AI Credits,${toAiCredits(stats.cliUsage.totalNanoAiu)?.toFixed(9) ?? ""}`);
  }
  lines.push("");

  // By Date section
  lines.push("# By Date");
  lines.push("Date,Shown,Accepted,Rate,Chat,CLI Prompts,CLI Tokens,CLI AI Credits");
  const sortedDates = Array.from(new Set([...stats.byDate.keys(), ...stats.cliByDate.keys()])).sort();
  for (const dateStr of sortedDates) {
    const stat = stats.byDate.get(dateStr) ?? { shown: 0, accepted: 0 };
    const rate = stat.shown > 0 ? `${((stat.accepted / stat.shown) * 100).toFixed(1)}%` : "";
    const chatCount = stats.chatByDate.get(dateStr) ?? 0;
    const cliStat = stats.cliByDate.get(dateStr);
    const cliUsage = cliStat?.usage;
    const cliTokens = cliUsage ? cliUsage.inputTokens + cliUsage.outputTokens : 0;
    const cliCredits = cliUsage ? (toAiCredits(cliUsage.totalNanoAiu)?.toFixed(9) ?? "") : "";
    lines.push(
      `${dateStr},${stat.shown},${stat.accepted},${rate},${chatCount},${cliStat?.prompts ?? 0},${cliTokens},${cliCredits}`,
    );
  }
  lines.push("");

  if (stats.cliUsageByModel && stats.cliUsageByModel.size > 0) {
    lines.push("# Copilot CLI Model Usage");
    lines.push("Model,Input Tokens,Output Tokens,Cache Read Tokens,Cache Write Tokens,Reasoning Tokens,AI Credits");
    for (const [model, usage] of Array.from(stats.cliUsageByModel.entries()).sort(
      (a, b) => (b[1].totalNanoAiu ?? -1) - (a[1].totalNanoAiu ?? -1),
    )) {
      lines.push(
        `${csvEscape(model)},${usage.inputTokens},${usage.outputTokens},${usage.cacheReadTokens},${usage.cacheWriteTokens},${usage.reasoningTokens},${toAiCredits(usage.totalNanoAiu)?.toFixed(9) ?? ""}`,
      );
    }
    lines.push("");
  }

  if (stats.cliThreads?.length) {
    lines.push("# Copilot CLI Threads");
    lines.push("Session,Title,Started At,Prompts,Input Tokens,Output Tokens,AI Credits");
    for (const thread of stats.cliThreads) {
      lines.push(
        [
          csvEscape(spreadsheetText(thread.sessionId)),
          csvEscape(spreadsheetText(thread.title)),
          thread.startedAt ?? "",
          thread.prompts,
          thread.usage.inputTokens,
          thread.usage.outputTokens,
          toAiCredits(thread.usage.totalNanoAiu)?.toFixed(9) ?? "",
        ].join(","),
      );
    }
    lines.push("");
  }

  // By Model section
  if (stats.byModel.size > 0) {
    lines.push("# Inline Completion Model");
    lines.push("Model,Shown,Accepted,Rate");
    for (const [model, stat] of Array.from(stats.byModel.entries()).sort((a, b) => b[1].shown - a[1].shown)) {
      const rate = stat.shown > 0 ? `${((stat.accepted / stat.shown) * 100).toFixed(1)}%` : "";
      lines.push(`${csvEscape(model)},${stat.shown},${stat.accepted},${rate}`);
    }
    lines.push("");
  }

  // By Chat Model section
  if (stats.byChatModel.size > 0) {
    lines.push("# Chat Model");
    lines.push("Model,Count");
    for (const [model, count] of Array.from(stats.byChatModel.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`${csvEscape(model)},${count}`);
    }
    lines.push("");
  }

  // By Chat Intent section
  if (stats.byChatIntent.size > 0) {
    lines.push("# Chat Intent");
    lines.push("Intent,Count");
    for (const [intent, count] of Array.from(stats.byChatIntent.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`${csvEscape(intent)},${count}`);
    }
    lines.push("");
  }

  // Activity by Hour section
  if (stats.byHour.size > 0 || stats.chatByHour.size > 0) {
    lines.push("# Activity by Hour");
    lines.push("Hour,Inline,Chat");
    for (let h = 0; h < 24; h++) {
      const hourKey = String(h).padStart(2, "0");
      const inline = stats.byHour.get(hourKey) ?? 0;
      const chat = stats.chatByHour.get(hourKey) ?? 0;
      lines.push(`${hourKey},${inline},${chat}`);
    }
    lines.push("");
  }

  // By Session section
  if (stats.bySession.size > 0) {
    lines.push("# Sessions");
    lines.push("Session,Shown,Accepted,Rate,Chat,Errors");
    const sessions = Array.from(stats.bySession.values()).sort((a, b) => b.sessionId.localeCompare(a.sessionId));
    for (const s of sessions) {
      const rate = s.shown > 0 ? `${((s.accepted / s.shown) * 100).toFixed(1)}%` : "";
      lines.push(`${csvEscape(s.sessionId)},${s.shown},${s.accepted},${rate},${s.chat},${s.errors}`);
    }
    lines.push("");
  }

  // Errors section
  if (stats.totalErrors > 0) {
    lines.push("# Errors by Type");
    lines.push("Error Type,Count");
    for (const [errorType, count] of Array.from(stats.errorsByType.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`${csvEscape(errorType)},${count}`);
    }
    lines.push("");
  }

  const featureSections: Array<[string, number, Map<string, number>]> = [
    ["# Browser Tool Signals", stats.browserToolInvocations, stats.browserToolsByType],
    ["# Plugin Or Skill Signals", stats.pluginOrSkillInvocations, stats.pluginOrSkillByName],
    ["# Session Memory Signals", stats.memoryManagementEvents.length, stats.memoryManagementByType],
    ["# Agent Debug Signals", stats.agentDebugEvents, stats.agentDebugByType],
  ];
  for (const [title, total, breakdown] of featureSections) {
    if (total === 0) {
      continue;
    }
    lines.push(title);
    lines.push("Type,Count");
    for (const [name, count] of Array.from(breakdown.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      lines.push(`${csvEscape(name)},${count}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Convert CopilotUsageStats to a pretty-printed JSON string. */
export function exportAsJson(stats: CopilotUsageStats): string {
  const obj = {
    summary: {
      totalShown: stats.totalShown,
      totalAccepted: stats.totalAccepted,
      totalRejected: stats.totalRejected,
      acceptanceRate: Number(stats.acceptanceRate.toFixed(1)),
      acceptanceRateAvailable: stats.totalShown > 0,
      totalChat: stats.totalChat,
      avgLatencyMs: Number(stats.avgLatencyMs.toFixed(0)),
      latencyP50: Number(stats.latencyP50.toFixed(0)),
      latencyP95: Number(stats.latencyP95.toFixed(0)),
      latencyP99: Number(stats.latencyP99.toFixed(0)),
      chatAvgLatencyMs: Number(stats.chatAvgLatencyMs.toFixed(0)),
      chatLatencyP50: Number(stats.chatLatencyP50.toFixed(0)),
      chatLatencyP95: Number(stats.chatLatencyP95.toFixed(0)),
      totalErrors: stats.totalErrors,
      logFilesFound: stats.logFilesFound,
      cliUsage: stats.cliUsage
        ? {
            ...stats.cliUsage,
            totalTokens: stats.cliUsage.inputTokens + stats.cliUsage.outputTokens,
            aiCredits: toAiCredits(stats.cliUsage.totalNanoAiu),
          }
        : null,
    },
    byDate: Object.fromEntries(
      Array.from(stats.byDate.entries()).map(([dateStr, stat]) => [
        dateStr,
        { ...stat, chat: stats.chatByDate.get(dateStr) ?? 0 },
      ]),
    ),
    cliUsageByDate: Object.fromEntries(stats.cliByDate),
    cliUsageByModel: stats.cliUsageByModel ? mapToObject(stats.cliUsageByModel) : {},
    cliThreads: stats.cliThreads ?? [],
    byModel: mapToObject<UsageStatCount>(stats.byModel),
    byChatModel: mapToObject<number>(stats.byChatModel),
    byChatIntent: mapToObject<number>(stats.byChatIntent),
    byHour: mapToObject<number>(stats.byHour),
    chatByHour: mapToObject<number>(stats.chatByHour),
    errorsByType: mapToObject<number>(stats.errorsByType),
    featureSignals: {
      browserTools: {
        total: stats.browserToolInvocations,
        breakdown: mapToObject<number>(stats.browserToolsByType),
      },
      pluginOrSkills: {
        total: stats.pluginOrSkillInvocations,
        breakdown: mapToObject<number>(stats.pluginOrSkillByName),
      },
      memoryManagement: {
        total: stats.memoryManagementEvents.length,
        breakdown: mapToObject<number>(stats.memoryManagementByType),
      },
      agentDebug: {
        total: stats.agentDebugEvents,
        breakdown: mapToObject<number>(stats.agentDebugByType),
      },
    },
    sessions: Array.from(stats.bySession.values()).sort((a, b) => b.sessionId.localeCompare(a.sessionId)),
  };

  return JSON.stringify(obj, null, 2);
}

function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  const obj: Record<string, T> = {};
  for (const [key, value] of map) {
    obj[key] = value;
  }
  return obj;
}

function spreadsheetText(value: string): string {
  // Quoting alone does not stop spreadsheet applications from evaluating formulas.
  return /^[\t\r\n]/.test(value) || /^\s*[=+@-]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
