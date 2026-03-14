import * as vscode from "vscode";
import { calculateWeeklyTrend } from "../metrics/weeklyTrend";
import type { CopilotUsageStats, DateStat } from "../types";
import { calculateTimeSavedMinutes, formatMinutesSaved, getRoiBadge, getRoiTier } from "../utils";

type TreeElement = CategoryItem | StatItem | ActionItem;

/** Maps a ROI tier to a VS Code ThemeColor id. */
const ROI_TIER_COLORS: Record<string, string> = {
  gold: "charts.orange",
  green: "charts.green",
  blue: "charts.blue",
};

/** Returns the ROI rank badge and ThemeColor based on total minutes saved. */
function getRoiRankStyle(totalMinutesSaved: number): { badge: string; color: vscode.ThemeColor } | null {
  const tier = getRoiTier(totalMinutesSaved);
  if (!tier) {
    return null;
  }
  return {
    badge: getRoiBadge(tier),
    color: new vscode.ThemeColor(ROI_TIER_COLORS[tier]),
  };
}

export class CopilotUsageTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _stats: CopilotUsageStats | undefined;
  private _hasData = false;

  get hasData(): boolean {
    return this._hasData;
  }

  updateStats(stats: CopilotUsageStats): void {
    this._stats = stats;
    this._hasData = true;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!this._stats) {
      return [];
    }

    if (!element) {
      return this._buildRootNodes(this._stats);
    }

    if (element instanceof CategoryItem) {
      return element.getChildren(this._stats);
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  private _buildRootNodes(stats: CopilotUsageStats): TreeElement[] {
    const nodes: TreeElement[] = [
      new ActionItem("Show Usage", SHOW_USAGE_COMMAND, "open-preview"),
      new CategoryItem("summary", "Key Performance Indicators", "dashboard", stats),
      new CategoryItem("trend", "Weekly Trend", "graph-line", stats),
      new CategoryItem("daily", "Daily (7 days)", "calendar", stats),
    ];

    if (stats.totalErrors > 0) {
      nodes.push(new CategoryItem("errors", "Errors", "warning", stats));
    }

    return nodes;
  }
}

class ActionItem extends vscode.TreeItem {
  constructor(label: string, command: vscode.Command, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = command;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "action-item";
  }
}

class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly category: string,
    label: string,
    icon: string,
    private readonly _stats: CopilotUsageStats,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = `category-${category}`;
  }

  getChildren(stats: CopilotUsageStats): StatItem[] {
    switch (this.category) {
      case "summary":
        return this._buildSummary(stats);
      case "trend":
        return this._buildTrend(stats);
      case "daily":
        return this._buildDaily(stats);
      case "errors":
        return this._buildErrors(stats);
      default:
        return [];
    }
  }

  private _buildSummary(stats: CopilotUsageStats): StatItem[] {
    const editorMinutesSaved = calculateTimeSavedMinutes(stats.totalAccepted, stats.autonomousDurationMs);
    const cliRoiPerInteraction =
      vscode.workspace.getConfiguration("copilot-insight").get<number>("cliRoiMinutesPerInteraction") ?? 30;
    const cliMinutesSaved = (stats.cliTotalInteractions ?? 0) * cliRoiPerInteraction;
    const totalMinutesSaved = editorMinutesSaved + cliMinutesSaved;
    const roiRank = getRoiRankStyle(totalMinutesSaved);
    const timeSavedLabel = `${roiRank?.badge ?? ""}${formatMinutesSaved(totalMinutesSaved)}`;
    const totalSessions = stats.bySession.size;

    const items: StatItem[] = [
      new StatItem("Accepted", String(stats.totalAccepted), "check"),
      new StatItem("Acceptance Rate", `${stats.acceptanceRate.toFixed(1)}%`, "percentage"),
      new StatItem("Time Saved (ROI)", timeSavedLabel, "clock", roiRank?.color),
    ];

    if (stats.avgLatencyMs > 0) {
      items.push(new StatItem("Avg Latency", `${stats.avgLatencyMs.toFixed(0)}ms`, "pulse"));
    }

    items.push(new StatItem("Active Sessions", String(totalSessions), "server-process"));

    return items;
  }

  private _buildTrend(stats: CopilotUsageStats): StatItem[] {
    const trend = calculateWeeklyTrend(stats.byDate, stats.chatByDate);

    const items: StatItem[] = [];

    const thisRateStr = trend.thisWeek.shown > 0 ? `${trend.thisWeek.rate.toFixed(1)}%` : "—";
    const lastRateStr = trend.lastWeek.shown > 0 ? `${trend.lastWeek.rate.toFixed(1)}%` : "—";
    const arrow = trend.rateDiff > 0 ? "↑" : trend.rateDiff < 0 ? "↓" : "→";
    const diffStr = trend.rateDiff !== 0 ? ` (${arrow}${Math.abs(trend.rateDiff).toFixed(1)}%)` : "";

    items.push(
      new StatItem("This Week Rate", `${thisRateStr}${diffStr}`, trend.rateDiff >= 0 ? "arrow-up" : "arrow-down"),
    );
    items.push(new StatItem("Last Week Rate", lastRateStr, "history"));
    items.push(
      new StatItem(
        "This Week",
        `${trend.thisWeek.shown} shown / ${trend.thisWeek.accepted} accepted / ${trend.thisWeek.chat} chat`,
        "pulse",
      ),
    );
    items.push(
      new StatItem(
        "Last Week",
        `${trend.lastWeek.shown} shown / ${trend.lastWeek.accepted} accepted / ${trend.lastWeek.chat} chat`,
        "pulse",
      ),
    );

    return items;
  }

  private _buildDaily(stats: CopilotUsageStats): StatItem[] {
    const dateEntries = Array.from(stats.byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7);

    let previousRate: number | undefined;
    return dateEntries.map(([dateStr, stat]: [string, DateStat]) => {
      const chatCount = stats.chatByDate.get(dateStr) ?? 0;
      const rate = stat.shown > 0 ? (stat.accepted / stat.shown) * 100 : 0;
      const rateStr = stat.shown > 0 ? `${rate.toFixed(1)}%` : "—";

      let trendIcon = "";
      if (previousRate !== undefined && stat.shown > 0) {
        trendIcon = rate > previousRate ? " ↑" : rate < previousRate ? " ↓" : " →";
      }
      previousRate = stat.shown > 0 ? rate : previousRate;

      const label = formatTreeDateLabel(dateStr);
      return new StatItem(label, `${rateStr}${trendIcon}  (${stat.shown}/${stat.accepted}/${chatCount})`, "calendar");
    });
  }

  private _buildErrors(stats: CopilotUsageStats): StatItem[] {
    const sorted = Array.from(stats.errorsByType.entries()).sort((a, b) => b[1] - a[1]);
    return sorted.map(([errorType, count]) => {
      return new StatItem(errorType, String(count), "error");
    });
  }
}

class StatItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon: string, iconColor?: vscode.ThemeColor) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon, iconColor);
  }
}

const SHOW_USAGE_COMMAND: vscode.Command = {
  command: "copilot-insight.showCopilotUsage",
  title: "Show Usage",
};

function formatTreeDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${mm}/${dd} (${dayNames[date.getDay()]})`;
  } catch {
    return dateStr;
  }
}
