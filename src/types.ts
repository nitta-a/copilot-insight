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
}

/** Internal state used during log parsing. Extends public stats with accumulators. */
export interface ParsingContext extends CopilotUsageStats {
  latencySum: number;
  latencyCount: number;
  chatLatencySum: number;
  chatLatencyCount: number;
  currentSessionId: string;
}
