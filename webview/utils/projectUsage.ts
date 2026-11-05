import type { SummaryData } from "../../src/ui/dashboardMessages";
import { toAiCredits } from "../../src/utils";

export type Project = NonNullable<NonNullable<SummaryData["cliUsageStats"]>["projects"]>[number];
export type ProjectPeriod = "all" | "week" | "lastWeek" | "month" | "7" | "14" | "30";

export function formatProjectShare(value: number | null, total: number | null): string {
  if (value === null || total === null || total <= 0) {
    return "Unavailable";
  }
  const percentage = (value / total) * 100;
  return percentage > 0 && percentage < 0.01 ? "<0.01%" : `${percentage.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function projectChartRows(projects: Project[]) {
  const total = projects.reduce((sum, project) => ({
    inputTokens: sum.inputTokens + project.inputTokens,
    outputTokens: sum.outputTokens + project.outputTokens,
    aiCredits: sum.aiCredits === null || project.aiCredits === null ? null : sum.aiCredits + project.aiCredits,
  }), { inputTokens: 0, outputTokens: 0, aiCredits: 0 as number | null });
  return [
    { ...total, label: "All projects", path: null },
    ...projects.map((project, index) => ({ ...project, label: `${index + 1}. ${project.name}` })),
  ];
}

export function projectPeriodRange(period: ProjectPeriod, now = new Date()): { start: string; end: string } | null {
  if (period === "all") {
    return null;
  }
  const today = now.toISOString().slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const end = period === "lastWeek" ? new Date(todayMs - (daysSinceMonday + 1) * 86_400_000).toISOString().slice(0, 10) : today;
  const start = period === "month"
    ? `${end.slice(0, 7)}-01`
    : new Date(Date.parse(`${end}T00:00:00Z`) - (period === "week" ? daysSinceMonday : period === "lastWeek" ? 6 : Number(period) - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}

export function projectsForPeriod(projects: Project[], period: ProjectPeriod, now = new Date()): Project[] {
  const range = projectPeriodRange(period, now);
  if (!range) {
    return projects;
  }
  return projects.flatMap((project) => {
    const days = project.dailyUsage.filter(({ date }) => date >= range.start && date <= range.end);
    if (!days.length) {
      return [];
    }
    const totals = days.reduce((sum, { usage }) => ({
      inputTokens: sum.inputTokens + usage.inputTokens,
      outputTokens: sum.outputTokens + usage.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + usage.cacheWriteTokens,
      totalNanoAiu: sum.totalNanoAiu === null || usage.totalNanoAiu === null ? null : sum.totalNanoAiu + usage.totalNanoAiu,
    }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalNanoAiu: 0 as number | null });
    return [{ ...project, ...totals, aiCredits: toAiCredits(totals.totalNanoAiu) }];
  }).sort((a, b) => b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens || a.name.localeCompare(b.name));
}
