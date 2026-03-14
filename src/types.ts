export interface UsageStatCount {
  shown: number;
  accepted: number;
}

/** @deprecated Use `UsageStatCount` instead. */
export type LanguageStat = UsageStatCount;

export interface SessionSummary {
  sessionId: string;
  title: string | null;
  date: string;
  totalActions: number;
  trueRate: number;
  autonomousDuration: number;
  efficiencyScore: number;
}

export interface SessionEpisode {
  episodeId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  phases: string[];
  aiActionCount: number;
  humanActionCount: number;
  accepted: boolean;
  contextBoundary: boolean;
  models: string[];
  summary: string;
  fatigueScore: number;
}

export interface SessionTimelineEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  actor: "human" | "ai" | "system";
  phase: "human" | "planning" | "research" | "execution" | "memory";
  label: string;
  detail: string;
  icon: string;
  accepted: boolean;
  episodeId: string | null;
}

export interface SessionThreadSummary {
  threadId: string;
  title: string;
  startedAt: string;
  estimatedMinutesSaved: number;
  autonomousDurationMs: number;
  acceptedChars: number;
  hasAutonomousRun: boolean;
  stepCount: number;
  longestPauseMs: number;
  hasSelectableTitle: boolean;
}

export type AgentStepLabel =
  | "Prompt"
  | "Updated"
  | "Executed"
  | "Searched"
  | "Reviewed"
  | "Evaluating"
  | "Considered"
  | "Creating"
  | "Used reference"
  | "Memory file"
  | "Thought"
  | "Activity";

export interface AgentStep {
  timestamp: string;
  actor: "human" | "ai" | "system";
  phase: "human" | "planning" | "research" | "execution" | "memory";
  label: AgentStepLabel;
  detail: string;
  rawIntent: string;
  durationMs?: number;
  isFallback?: boolean;
  isSignificantPause?: boolean;
}

export interface ContextFatigueMarker {
  timestamp: string;
  episodeId: string;
  score: number;
  reason: string;
}

export interface SessionDetailPayload {
  sessionId: string;
  date: string;
  totalActions: number;
  trueRate: number;
  autonomousDuration: number;
  efficiencyScore: number;
  timeline: SessionTimelineEntry[];
  episodes: SessionEpisode[];
  fatigueMarker: ContextFatigueMarker | null;
  threads: SessionThreadSummary[];
  stepsByThread: Record<string, AgentStep[]>;
}

/** Histogram buckets for the distribution of action counts per agentic loop. */
export interface LoopActionBuckets {
  /** Loops that contained exactly 1 action. */
  bucket1: number;
  /** Loops that contained exactly 2 actions. */
  bucket2: number;
  /** Loops that contained 3–5 actions. */
  bucket3to5: number;
  /** Loops that contained 6–10 actions. */
  bucket6to10: number;
  /** Loops that contained 11 or more actions. */
  bucket11plus: number;
}

/** Per-model agentic depth statistics for model-comparison analytics. */
export interface AgenticDepthStat {
  /** Distribution of completed loop action counts (histogram). */
  loopDistribution: LoopActionBuckets;
  /** Average number of actions per completed loop (0 when no completed loops). */
  avgLoopActions: number;
  /**
   * Task completion rate: percentage of started loops that ended with
   * `shouldContinue=false` (0–100).  0 when no loops were started.
   */
  completionRate: number;
  /**
   * Average time per action in milliseconds (autonomous duration divided by
   * actions in completed loops).  Represents the model's "thinking speed".
   * 0 when no completed loops with duration data exist.
   */
  velocityMsPerAction: number;
}

export interface DateStat {
  shown: number;
  accepted: number;
}

/** Daily statistics for GitHub Copilot CLI interactions. */
export interface CliDateStat {
  /** Number of user prompts sent to the CLI on this day. */
  prompts: number;
  /** Total output tokens returned by the AI on this day. */
  outputTokens: number;
}

export interface SessionStat {
  sessionId: string;
  shown: number;
  accepted: number;
  chat: number;
  errors: number;
}

export interface MemoryManagementEvent {
  timestamp: string;
  type: string;
  rawText: string;
  sessionId: string;
}

export interface ChatSessionTitleRecord {
  chatSessionId: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
  firstRequestText: string | null;
}

export interface SkillRef {
  name: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: string;
  subagentDescription?: string;
  childToolCalls?: ToolCallInfo[];
  mcpServer?: string;
}

export interface ChatSessionRequest {
  requestId: string;
  timestamp: number;
  agentId: string;
  customAgentName: string | null;
  modelId: string;
  messageText: string;
  timings: {
    firstProgress: number | null;
    totalElapsed: number | null;
  };
  toolCalls: ToolCallInfo[];
  availableSkills: SkillRef[];
  loadedSkills: SkillRef[];
}

export interface ChatSessionRecord {
  chatSessionId: string;
  workspaceId: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  firstRequestText: string | null;
  requests: ChatSessionRequest[];
  source: "jsonl" | "json";
  provider: "copilot";
}

export interface RefreshAnalysisSegment {
  turnCount: number;
  rawAccepted: number;
  trueAccepted: number;
  rawRate: number;
  trueRate: number;
  revertedCount: number;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface RefreshAnalysis {
  event: MemoryManagementEvent;
  windowMinutes: number;
  turnWindowSize: number;
  preWindow: RefreshAnalysisSegment;
  postWindow: RefreshAnalysisSegment;
  preTurns: RefreshAnalysisSegment;
  postTurns: RefreshAnalysisSegment;
  recoveryDelta: number;
  refreshRoi: number | null;
}

export interface CopilotUsageStats {
  totalShown: number;
  totalAccepted: number;
  totalRejected: number;
  totalChat: number;
  acceptanceRate: number;
  avgLatencyMs: number;
  byDate: Map<string, DateStat>;
  byModel: Map<string, UsageStatCount>;
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
  /** Per context source shown/accepted counts for effectiveness analysis. */
  byContextEffectiveness: Map<string, UsageStatCount>;

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
  /**
   * Per-model agentic depth statistics:
   * - action-count histogram per loop
   * - average loop actions
   * - task completion rate
   * - velocity (avg ms per action)
   */
  agenticDepthByModel: Map<string, AgenticDepthStat>;
  /** Per-date agentic depth statistics for autonomy evolution. */
  byDateAgenticDepth: Map<string, AgenticDepthStat>;

  // Planning & Execution tracking
  /** Total number of plans proposed by the agent (agent/plan or strategy/propose). */
  planCount: number;
  /** Number of plans that were followed by a file edit or patch application. */
  executedPlanCount: number;
  /** Number of in-plan user choice interactions (choice_selected). */
  userChoicesInPlan: number;

  /** Number of browser-tool related events observed in logs. */
  browserToolInvocations: number;
  /** Browser-tool events grouped by detected action or subtype. */
  browserToolsByType: Map<string, number>;
  /** Number of plugin or skill related events observed in logs. */
  pluginOrSkillInvocations: number;
  /** Plugin or skill events grouped by detected name or subtype. */
  pluginOrSkillByName: Map<string, number>;
  /** Session-memory or compaction events observed in logs with timestamps. */
  memoryManagementEvents: MemoryManagementEvent[];
  /** Synthetic session-level signal events derived from parsed Copilot logs. */
  sessionSignals: import("./events/eventSchema").SessionSignalEvent[];
  /** Chat titles recovered from workspaceStorage chatSessions files. */
  chatSessionTitles?: ChatSessionTitleRecord[];
  /** Chat session records recovered from workspaceStorage chatSessions files. */
  chatSessions?: ChatSessionRecord[];
  /** Session-memory or compaction events grouped by detected subtype. */
  memoryManagementByType: Map<string, number>;
  /** Number of agent-debug or step-execution related events observed in logs. */
  agentDebugEvents: number;
  /** Agent-debug events grouped by detected subtype. */
  agentDebugByType: Map<string, number>;

  // CLI usage (GitHub Copilot CLI / copilot-agent sessions)
  /** Per-date CLI interaction statistics (prompts + output tokens). */
  cliByDate: Map<string, CliDateStat>;
  /** Total number of CLI prompt interactions across all sessions. */
  cliTotalInteractions: number;

  // Slash commands and @participants usage
  /** Usage counts for slash commands (/fix, /explain, …) and @participants (@workspace, …). */
  commandUsage: Map<string, number>;
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
  /** Number of subagent actions seen in the currently active loop. */
  activeSubagentLoopActionCount: number;
  /** Per-model count of loops that have been started. */
  loopsStartedByModel: Map<string, number>;
  /** Per-model count of loops that completed with shouldContinue=false. */
  loopsCompletedByModel: Map<string, number>;
  /** Per-model total number of actions across all completed loops. */
  totalLoopActionsByModel: Map<string, number>;
  /** Per-model histogram of action counts for completed loops. */
  loopDistributionByModel: Map<string, LoopActionBuckets>;
  /** Per-date count of loops that have been started. */
  loopsStartedByDate: Map<string, number>;
  /** Per-date count of loops that completed with shouldContinue=false. */
  loopsCompletedByDate: Map<string, number>;
  /** Per-date total number of actions across all completed loops. */
  totalLoopActionsByDate: Map<string, number>;
  /** Per-date histogram of action counts for completed loops. */
  loopDistributionByDate: Map<string, LoopActionBuckets>;
  /** Per-date total autonomous duration in milliseconds. */
  autonomousDurationByDate: Map<string, number>;
  /** True when a plan has been proposed but not yet followed by an edit/patch action. */
  activePlanPending: boolean;
}
