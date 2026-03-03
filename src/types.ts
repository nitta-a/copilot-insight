export interface LanguageStat {
  shown: number;
  accepted: number;
}

export interface DateStat {
  shown: number;
  accepted: number;
}

export interface SessionStat {
  sessionId: string;
  shown: number;
  accepted: number;
  chat: number;
  errors: number;
}

export interface CopilotUsageStats {
  totalShown: number;
  totalAccepted: number;
  totalRejected: number;
  totalChat: number;
  acceptanceRate: number;
  avgLatencyMs: number;
  byDate: Map<string, DateStat>;
  byModel: Map<string, LanguageStat>;
  byChatModel: Map<string, number>;
  byHour: Map<string, number>;
  byChatIntent: Map<string, number>;
  logFilesFound: number;

  // Chat activity tracking
  chatByDate: Map<string, number>;
  chatByHour: Map<string, number>;

  // Error tracking
  totalErrors: number;
  errorsByType: Map<string, number>;

  // Latency distribution
  latencies: number[];
  chatLatencies: number[];
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  chatAvgLatencyMs: number;
  chatLatencyP50: number;
  chatLatencyP95: number;

  // Session tracking
  bySession: Map<string, SessionStat>;

  // Context Window Insights
  byContextSource: Map<string, number>;

  // Subagent / Agentic activity
  /** Total number of requests identified as subagent-initiated. */
  subagentRequests: number;
  /** Ratio of subagent requests to total requests (0–100). */
  agenticRatio: number;
  /** Total duration (ms) during which a subagent ToolCallingLoop was active. */
  autonomousDurationMs: number;
  /** Per-intent execution counts (e.g. "runSubagent", "editAgent"). */
  toolUsageStats: Map<string, number>;
  /** Number of completed ToolCallingLoop instances (distinct agentic episodes). */
  subagentLoops: number;
  /** Number of ToolCallingLoop instances started (first subagent request seen). */
  subagentLoopsStarted: number;
  /** Episode completion rate: subagentLoops / subagentLoopsStarted * 100 (0 when no loops started). */
  completionRate: number;
  /** Per-model count of subagent-initiated requests. */
  subagentByModel: Map<string, number>;
  /** Per-model total autonomous duration (ms). */
  autonomousDurationByModel: Map<string, number>;
}

/** Internal state used during log parsing. Extends public stats with accumulators. */
export interface ParsingContext extends CopilotUsageStats {
  latencySum: number;
  latencyCount: number;
  chatLatencySum: number;
  chatLatencyCount: number;
  currentSessionId: string;
  /**
   * ISO-8601 timestamp of the most recently seen subagent loop start.
   * `null` when no loop is currently active.
   */
  activeSubagentLoop: string | null;
  /** Model name associated with the currently active subagent loop. `null` when no loop is active. */
  activeSubagentLoopModel: string | null;
}
