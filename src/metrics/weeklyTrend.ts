import type { AgenticDepthStat, DateStat } from "../types";

export interface WeekStat {
  shown: number;
  accepted: number;
  rate: number;
  chat: number;
}

export interface WeeklyComparison {
  thisWeek: WeekStat;
  lastWeek: WeekStat;
  /** Acceptance rate difference (thisWeek.rate - lastWeek.rate). Positive = improved. */
  rateDiff: number;
}

export interface AgenticWeekStat {
  completedLoops: number;
  totalActions: number;
  avgDepth: number;
}

export interface AgenticWeeklyComparison {
  thisWeek: AgenticWeekStat;
  lastWeek: AgenticWeekStat;
  /** Average depth difference (thisWeek.avgDepth - lastWeek.avgDepth). */
  depthDiff: number;
  /** Relative change vs last week, where 0.2 = +20%. */
  depthGrowthRate: number;
}

/**
 * Calculate weekly trend by comparing this week (Mon–today) with last week (Mon–Sun).
 * Uses ISO week convention: Monday = start of week.
 */
export function calculateWeeklyTrend(byDate: Map<string, DateStat>, chatByDate: Map<string, number>): WeeklyComparison {
  const { today, thisMonday, lastMonday, lastSunday } = getWeekBoundaries();

  const thisWeek = aggregateDateRange(byDate, chatByDate, thisMonday, today);
  const lastWeek = aggregateDateRange(byDate, chatByDate, lastMonday, lastSunday);

  const rateDiff = thisWeek.shown > 0 && lastWeek.shown > 0 ? thisWeek.rate - lastWeek.rate : 0;

  return { thisWeek, lastWeek, rateDiff };
}

export function calculateWeeklyAgenticDepthTrend(
  byDateAgenticDepth: Map<string, AgenticDepthStat>,
): AgenticWeeklyComparison {
  const { today, thisMonday, lastMonday, lastSunday } = getWeekBoundaries();
  const thisWeek = aggregateAgenticDateRange(byDateAgenticDepth, thisMonday, today);
  const lastWeek = aggregateAgenticDateRange(byDateAgenticDepth, lastMonday, lastSunday);
  const depthDiff = thisWeek.avgDepth - lastWeek.avgDepth;
  const depthGrowthRate = lastWeek.avgDepth > 0 ? depthDiff / lastWeek.avgDepth : 0;
  return {
    thisWeek,
    lastWeek,
    depthDiff,
    depthGrowthRate,
  };
}

function aggregateDateRange(
  byDate: Map<string, DateStat>,
  chatByDate: Map<string, number>,
  start: Date,
  end: Date,
): WeekStat {
  let shown = 0;
  let accepted = 0;
  let chat = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = formatDate(current);
    const dateStat = byDate.get(dateStr);
    if (dateStat) {
      shown += dateStat.shown;
      accepted += dateStat.accepted;
    }
    chat += chatByDate.get(dateStr) ?? 0;
    current.setDate(current.getDate() + 1);
  }

  const rate = shown > 0 ? (accepted / shown) * 100 : 0;
  return { shown, accepted, rate, chat };
}

function aggregateAgenticDateRange(
  byDateAgenticDepth: Map<string, AgenticDepthStat>,
  start: Date,
  end: Date,
): AgenticWeekStat {
  let completedLoops = 0;
  let totalActions = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = formatDate(current);
    const dateStat = byDateAgenticDepth.get(dateStr);
    if (dateStat) {
      const completedForDay = countCompletedLoops(dateStat);
      completedLoops += completedForDay;
      totalActions += dateStat.avgLoopActions * completedForDay;
    }
    current.setDate(current.getDate() + 1);
  }

  const avgDepth = completedLoops > 0 ? totalActions / completedLoops : 0;
  return { completedLoops, totalActions, avgDepth };
}

function countCompletedLoops(stat: AgenticDepthStat): number {
  const { bucket1, bucket2, bucket3to5, bucket6to10, bucket11plus } = stat.loopDistribution;
  return bucket1 + bucket2 + bucket3to5 + bucket6to10 + bucket11plus;
}

function getWeekBoundaries(): { today: Date; thisMonday: Date; lastMonday: Date; lastSunday: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayOfWeek = today.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysFromMonday);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);

  return { today, thisMonday, lastMonday, lastSunday };
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
