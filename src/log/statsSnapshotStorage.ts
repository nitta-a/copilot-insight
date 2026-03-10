import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SessionSignalEvent } from "../events/eventSchema";
import type {
  AgenticDepthStat,
  ChatSessionTitleRecord,
  CopilotUsageStats,
  DateStat,
  LanguageStat,
  MemoryManagementEvent,
  SessionStat,
} from "../types";

interface SerializedStatsSnapshot {
  version: 1 | 2;
  stats: SerializedCopilotUsageStats;
}

interface SerializedCopilotUsageStats {
  totalShown: number;
  totalAccepted: number;
  totalRejected: number;
  totalChat: number;
  acceptanceRate: number;
  avgLatencyMs: number;
  byDate: Array<[string, DateStat]>;
  byModel: Array<[string, LanguageStat]>;
  byChatModel: Array<[string, number]>;
  byHour: Array<[string, number]>;
  byChatIntent: Array<[string, number]>;
  logFilesFound: number;
  chatByDate: Array<[string, number]>;
  chatByHour: Array<[string, number]>;
  totalErrors: number;
  errorsByType: Array<[string, number]>;
  latencies: number[];
  chatLatencies: number[];
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  chatAvgLatencyMs: number;
  chatLatencyP50: number;
  chatLatencyP95: number;
  bySession: Array<[string, SessionStat]>;
  byContextSource: Array<[string, number]>;
  byContextEffectiveness: Array<[string, LanguageStat]>;
  subagentRequests: number;
  agenticRatio: number;
  autonomousDurationMs: number;
  toolUsageStats: Array<[string, number]>;
  subagentLoops: number;
  subagentLoopsStarted: number;
  completionRate: number;
  subagentByModel: Array<[string, number]>;
  autonomousDurationByModel: Array<[string, number]>;
  agenticDepthByModel: Array<[string, AgenticDepthStat]>;
  byDateAgenticDepth: Array<[string, AgenticDepthStat]>;
  planCount: number;
  executedPlanCount: number;
  userChoicesInPlan: number;
  browserToolInvocations: number;
  browserToolsByType: Array<[string, number]>;
  pluginOrSkillInvocations: number;
  pluginOrSkillByName: Array<[string, number]>;
  memoryManagementEvents: MemoryManagementEvent[] | number;
  sessionSignals: SessionSignalEvent[];
  chatSessionTitles?: ChatSessionTitleRecord[];
  memoryManagementByType: Array<[string, number]>;
  agentDebugEvents: number;
  agentDebugByType: Array<[string, number]>;
  premiumRequestCount: number;
  premiumRequestsByModel: Array<[string, number]>;
}

function mapEntries<K, V>(value: Map<K, V>): Array<[K, V]> {
  return [...value.entries()];
}

function toMap<K, V>(entries: Array<[K, V]> | undefined): Map<K, V> {
  return new Map(entries ?? []);
}

function serializeStats(stats: CopilotUsageStats): SerializedCopilotUsageStats {
  return {
    totalShown: stats.totalShown,
    totalAccepted: stats.totalAccepted,
    totalRejected: stats.totalRejected,
    totalChat: stats.totalChat,
    acceptanceRate: stats.acceptanceRate,
    avgLatencyMs: stats.avgLatencyMs,
    byDate: mapEntries(stats.byDate),
    byModel: mapEntries(stats.byModel),
    byChatModel: mapEntries(stats.byChatModel),
    byHour: mapEntries(stats.byHour),
    byChatIntent: mapEntries(stats.byChatIntent),
    logFilesFound: stats.logFilesFound,
    chatByDate: mapEntries(stats.chatByDate),
    chatByHour: mapEntries(stats.chatByHour),
    totalErrors: stats.totalErrors,
    errorsByType: mapEntries(stats.errorsByType),
    latencies: [...stats.latencies],
    chatLatencies: [...stats.chatLatencies],
    latencyP50: stats.latencyP50,
    latencyP95: stats.latencyP95,
    latencyP99: stats.latencyP99,
    chatAvgLatencyMs: stats.chatAvgLatencyMs,
    chatLatencyP50: stats.chatLatencyP50,
    chatLatencyP95: stats.chatLatencyP95,
    bySession: mapEntries(stats.bySession),
    byContextSource: mapEntries(stats.byContextSource),
    byContextEffectiveness: mapEntries(stats.byContextEffectiveness),
    subagentRequests: stats.subagentRequests,
    agenticRatio: stats.agenticRatio,
    autonomousDurationMs: stats.autonomousDurationMs,
    toolUsageStats: mapEntries(stats.toolUsageStats),
    subagentLoops: stats.subagentLoops,
    subagentLoopsStarted: stats.subagentLoopsStarted,
    completionRate: stats.completionRate,
    subagentByModel: mapEntries(stats.subagentByModel),
    autonomousDurationByModel: mapEntries(stats.autonomousDurationByModel),
    agenticDepthByModel: mapEntries(stats.agenticDepthByModel),
    byDateAgenticDepth: mapEntries(stats.byDateAgenticDepth),
    planCount: stats.planCount,
    executedPlanCount: stats.executedPlanCount,
    userChoicesInPlan: stats.userChoicesInPlan,
    browserToolInvocations: stats.browserToolInvocations,
    browserToolsByType: mapEntries(stats.browserToolsByType),
    pluginOrSkillInvocations: stats.pluginOrSkillInvocations,
    pluginOrSkillByName: mapEntries(stats.pluginOrSkillByName),
    memoryManagementEvents: [...stats.memoryManagementEvents],
    sessionSignals: [...stats.sessionSignals],
    chatSessionTitles: [...(stats.chatSessionTitles ?? [])],
    memoryManagementByType: mapEntries(stats.memoryManagementByType),
    agentDebugEvents: stats.agentDebugEvents,
    agentDebugByType: mapEntries(stats.agentDebugByType),
    premiumRequestCount: stats.premiumRequestCount,
    premiumRequestsByModel: mapEntries(stats.premiumRequestsByModel),
  };
}

function deserializeStats(stats: SerializedCopilotUsageStats): CopilotUsageStats {
  return {
    totalShown: stats.totalShown,
    totalAccepted: stats.totalAccepted,
    totalRejected: stats.totalRejected,
    totalChat: stats.totalChat,
    acceptanceRate: stats.acceptanceRate,
    avgLatencyMs: stats.avgLatencyMs,
    byDate: toMap(stats.byDate),
    byModel: toMap(stats.byModel),
    byChatModel: toMap(stats.byChatModel),
    byHour: toMap(stats.byHour),
    byChatIntent: toMap(stats.byChatIntent),
    logFilesFound: stats.logFilesFound,
    chatByDate: toMap(stats.chatByDate),
    chatByHour: toMap(stats.chatByHour),
    totalErrors: stats.totalErrors,
    errorsByType: toMap(stats.errorsByType),
    latencies: [...stats.latencies],
    chatLatencies: [...stats.chatLatencies],
    latencyP50: stats.latencyP50,
    latencyP95: stats.latencyP95,
    latencyP99: stats.latencyP99,
    chatAvgLatencyMs: stats.chatAvgLatencyMs,
    chatLatencyP50: stats.chatLatencyP50,
    chatLatencyP95: stats.chatLatencyP95,
    bySession: toMap(stats.bySession),
    byContextSource: toMap(stats.byContextSource),
    byContextEffectiveness: toMap(stats.byContextEffectiveness),
    subagentRequests: stats.subagentRequests,
    agenticRatio: stats.agenticRatio,
    autonomousDurationMs: stats.autonomousDurationMs,
    toolUsageStats: toMap(stats.toolUsageStats),
    subagentLoops: stats.subagentLoops,
    subagentLoopsStarted: stats.subagentLoopsStarted,
    completionRate: stats.completionRate,
    subagentByModel: toMap(stats.subagentByModel),
    autonomousDurationByModel: toMap(stats.autonomousDurationByModel),
    agenticDepthByModel: toMap(stats.agenticDepthByModel),
    byDateAgenticDepth: toMap(stats.byDateAgenticDepth),
    planCount: stats.planCount,
    executedPlanCount: stats.executedPlanCount,
    userChoicesInPlan: stats.userChoicesInPlan,
    browserToolInvocations: stats.browserToolInvocations,
    browserToolsByType: toMap(stats.browserToolsByType),
    pluginOrSkillInvocations: stats.pluginOrSkillInvocations,
    pluginOrSkillByName: toMap(stats.pluginOrSkillByName),
    memoryManagementEvents: Array.isArray(stats.memoryManagementEvents) ? stats.memoryManagementEvents : [],
    sessionSignals: Array.isArray(stats.sessionSignals) ? stats.sessionSignals : [],
    chatSessionTitles: Array.isArray(stats.chatSessionTitles) ? stats.chatSessionTitles : [],
    memoryManagementByType: toMap(stats.memoryManagementByType),
    agentDebugEvents: stats.agentDebugEvents,
    agentDebugByType: toMap(stats.agentDebugByType),
    premiumRequestCount: stats.premiumRequestCount ?? 0,
    premiumRequestsByModel: toMap(stats.premiumRequestsByModel),
  };
}

export class StatsSnapshotStorage {
  private readonly snapshotPath: string;

  constructor(globalStoragePath: string) {
    this.snapshotPath = path.join(globalStoragePath, "usage-stats.json");
  }

  async read(): Promise<CopilotUsageStats | undefined> {
    try {
      const raw = await fs.readFile(this.snapshotPath, "utf-8");
      const snapshot = JSON.parse(raw) as SerializedStatsSnapshot;
      if (snapshot.version !== 1 && snapshot.version !== 2) {
        return undefined;
      }
      return deserializeStats(snapshot.stats);
    } catch {
      return undefined;
    }
  }

  async write(stats: CopilotUsageStats): Promise<void> {
    const payload: SerializedStatsSnapshot = {
      version: 2,
      stats: serializeStats(stats),
    };
    try {
      await fs.mkdir(path.dirname(this.snapshotPath), { recursive: true });
      await fs.writeFile(this.snapshotPath, JSON.stringify(payload), "utf-8");
    } catch {
      // Silently ignore write errors to preserve extension stability.
    }
  }
}
