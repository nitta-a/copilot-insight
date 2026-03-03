import * as vscode from "vscode";
import type { CopilotUsageStats, DateStat } from "../types";
import { calculateWeeklyTrend } from "../metrics/weeklyTrend";

type TreeElement = CategoryItem | StatItem;

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

  private _buildRootNodes(stats: CopilotUsageStats): CategoryItem[] {
    const nodes: CategoryItem[] = [
      new CategoryItem("summary", "Summary", "dashboard", stats),
      new CategoryItem("trend", "Weekly Trend", "graph-line", stats),
      new CategoryItem("daily", "Daily (7 days)", "calendar", stats),
    ];

    if (stats.totalErrors > 0) {
      nodes.push(new CategoryItem("errors", "Errors", "warning", stats));
    }

    return nodes;
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
    const items: StatItem[] = [
      new StatItem("Shown", String(stats.totalShown), "symbol-event"),
      new StatItem("Accepted", String(stats.totalAccepted), "check"),
      new StatItem("Acceptance Rate", `${stats.acceptanceRate.toFixed(1)}%`, "percentage"),
      new StatItem("Chat Requests", String(stats.totalChat), "comment-discussion"),
    ];

    if (stats.avgLatencyMs > 0) {
      items.push(new StatItem("Avg Latency", `${stats.avgLatencyMs.toFixed(0)}ms`, "clock"));
    }

    items.push(new StatItem("Log Files", String(stats.logFilesFound), "file"));

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
  constructor(label: string, description: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

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
