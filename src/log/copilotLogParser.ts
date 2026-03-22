import * as vscode from "vscode";
import * as path from "node:path";
import type { ChatSessionRecord, ChatSessionTitleRecord, CopilotUsageStats, ParsingContext } from "../types";
import { resolveLogSearchPaths } from "../utils/logPaths";
import {
  discoverWindowsWorkspaceStorageRoots,
  readChatSessionRecords,
  readChatSessionTitleRecords,
  resolveWorkspaceStorageRoot,
} from "./chatSessionTitleReader";
import { readCliStats } from "./cliLogReader";
import {
  findCopilotDirs,
  getAllSessionDirs,
  getSortedSessionDirs,
  parseLogDirectory,
  parseRemoteExthostLog,
  parseSessionTerminalLog,
} from "./logFileReader";

export type { CopilotUsageStats, DateStat } from "../types";

export interface ParseCopilotLogsOptions {
  scanAllSessions?: boolean;
  /**
   * Maximum number of sessions to parse.  When set, only the most recent
   * `limitSessions` session directories are processed, enabling fast initial
   * dashboard loads.  Ignored when `scanAllSessions` is true.
   */
  limitSessions?: number;
}

/** Lazy output channel for diagnostic logging. */
let _outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel("Copilot Insight");
  }
  return _outputChannel;
}

/** Maximum number of latency samples to retain per category to prevent unbounded memory growth. */
const MAX_LATENCY_SAMPLES = 10_000;

export async function parseCopilotLogs(
  logUri: vscode.Uri,
  options?: ParseCopilotLogsOptions,
): Promise<CopilotUsageStats> {
  const ctx: ParsingContext = {
    totalShown: 0,
    totalAccepted: 0,
    totalRejected: 0,
    totalChat: 0,
    acceptanceRate: 0,
    avgLatencyMs: 0,
    byDate: new Map(),
    byModel: new Map(),
    byChatModel: new Map(),
    byHour: new Map(),
    byChatIntent: new Map(),
    logFilesFound: 0,
    chatByDate: new Map(),
    chatByHour: new Map(),
    totalErrors: 0,
    errorsByType: new Map(),
    latencies: [],
    chatLatencies: [],
    latencyP50: 0,
    latencyP95: 0,
    latencyP99: 0,
    chatAvgLatencyMs: 0,
    chatLatencyP50: 0,
    chatLatencyP95: 0,
    bySession: new Map(),
    byContextSource: new Map(),
    byContextEffectiveness: new Map(),
    subagentRequests: 0,
    agenticRatio: 0,
    autonomousDurationMs: 0,
    toolUsageStats: new Map(),
    subagentLoops: 0,
    subagentLoopsStarted: 0,
    completionRate: 0,
    subagentByModel: new Map(),
    autonomousDurationByModel: new Map(),
    agenticDepthByModel: new Map(),
    byDateAgenticDepth: new Map(),
    latencySum: 0,
    latencyCount: 0,
    chatLatencySum: 0,
    chatLatencyCount: 0,
    currentSessionId: "",
    activeSubagentLoop: null,
    activeSubagentLoopModel: null,
    activeSubagentLoopActionCount: 0,
    loopsStartedByModel: new Map(),
    loopsCompletedByModel: new Map(),
    totalLoopActionsByModel: new Map(),
    loopDistributionByModel: new Map(),
    loopsStartedByDate: new Map(),
    loopsCompletedByDate: new Map(),
    totalLoopActionsByDate: new Map(),
    loopDistributionByDate: new Map(),
    autonomousDurationByDate: new Map(),
    planCount: 0,
    executedPlanCount: 0,
    userChoicesInPlan: 0,
    browserToolInvocations: 0,
    browserToolsByType: new Map(),
    pluginOrSkillInvocations: 0,
    pluginOrSkillByName: new Map(),
    memoryManagementEvents: [],
    sessionSignals: [],
    chatSessionTitles: [],
    chatSessions: [],
    memoryManagementByType: new Map(),
    agentDebugEvents: 0,
    agentDebugByType: new Map(),
    activePlanPending: false,
    cliByDate: new Map(),
    cliTotalInteractions: 0,
    commandUsage: new Map(),
    promptEffectiveness: {},
    chatSessionStates: new Map(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    tokensByModel: new Map(),
    finishReasonCounts: new Map(),
  };

  try {
    // Locate the VS Code session root by splitting fsPath on the native
    // separator and finding the `logs` landmark segment — depth-independent
    // and correct on both macOS ('/') and Windows ('\').
    const channel = getOutputChannel();
    channel.appendLine(`Original logUri: ${logUri.fsPath}`);

    const { sessionRoot, logBaseDir, fallbackSessionDir } = resolveLogSearchPaths(logUri.fsPath);
    channel.appendLine(sessionRoot ? `Session root: ${sessionRoot}` : `Session root: not found`);
    if (!sessionRoot) {
      channel.appendLine(`Warning: could not detect session root from ${logUri.fsPath}; using inferred fallback`);
    }

    channel.appendLine(`Searching for logs in: ${logBaseDir}`);

    const sessionDirs = options?.scanAllSessions
      ? await getAllSessionDirs(logBaseDir, fallbackSessionDir)
      : await getSortedSessionDirs(logBaseDir, fallbackSessionDir, { limit: options?.limitSessions });

    // Process all session directories in parallel. Note: ctx.currentSessionId is
    // shared state set per-session below; when sessions run concurrently it acts
    // as a best-effort fallback — most log lines embed their own session ID in
    // the JSON payload and do not rely on this field.
    await Promise.all(
      sessionDirs.map(async (sessDir) => {
        try {
          ctx.currentSessionId = path.basename(sessDir);
          channel.appendLine(`Scanning session: ${sessDir}`);

          const copilotDirs = await findCopilotDirs(sessDir);
          channel.appendLine(`  Copilot log dirs detected: ${copilotDirs.length}`);
          if (copilotDirs.length === 0) {
            channel.appendLine(`  Skipped: no GitHub Copilot log directories found in ${sessDir}`);
          }
          for (const copilotLogDir of copilotDirs) {
            channel.appendLine(`  Found Copilot log dir: ${copilotLogDir}`);
            const beforeFiles = ctx.logFilesFound;
            await parseLogDirectory(copilotLogDir, ctx);
            channel.appendLine(`    Parsed ${ctx.logFilesFound - beforeFiles} file(s)`);
          }

          const terminalLogParsed = await parseSessionTerminalLog(sessDir, ctx);
          channel.appendLine(
            `  Terminal log ${terminalLogParsed ? "parsed" : "missing/unreadable"}: ${path.join(sessDir, "terminal.log")}`,
          );

          // Also parse all .log files inside exthost<N>/ subdirectories — present in
          // VS Code Remote / WSL sessions; contains MCP and agentic-loop signals.
          const exthostResult = await parseRemoteExthostLog(sessDir, ctx);
          channel.appendLine(
            `  Remote exthost dirs detected: ${exthostResult.matchedDirs}, parsed files: ${exthostResult.parsedFiles}`,
          );
        } catch {
          // Skip unreadable session directories
          channel.appendLine(`  Skipped: could not read session directory ${sessDir}`);
        }
      }),
    );
    channel.appendLine(
      `Scan complete: logFilesFound=${ctx.logFilesFound}, shown=${ctx.totalShown}, accepted=${ctx.totalAccepted}, chat=${ctx.totalChat}`,
    );
    // NOTE: SQLite workspace chat-session reads are intentionally deferred.
    // Call readWorkspaceChatSessions(logBaseDir) on demand (e.g. when the
    // Sessions tab is first opened) to avoid blocking the initial parse.
  } catch (e) {
    console.error("Error parsing Copilot logs:", e instanceof Error ? e.message : "unknown error");
  }

  if (ctx.totalShown > 0) {
    ctx.acceptanceRate = (ctx.totalAccepted / ctx.totalShown) * 100;
  }
  if (ctx.latencyCount > 0) {
    ctx.avgLatencyMs = ctx.latencySum / ctx.latencyCount;
  }
  if (ctx.chatLatencyCount > 0) {
    ctx.chatAvgLatencyMs = ctx.chatLatencySum / ctx.chatLatencyCount;
  }

  const totalRequests = ctx.totalShown + ctx.totalChat;
  if (totalRequests > 0) {
    ctx.agenticRatio = (ctx.subagentRequests / totalRequests) * 100;
  }

  if (ctx.subagentLoopsStarted > 0) {
    ctx.completionRate = (ctx.subagentLoops / ctx.subagentLoopsStarted) * 100;
  }

  // Compute per-model agentic depth statistics from accumulated data.
  const allModelKeys = new Set([...ctx.loopsStartedByModel.keys(), ...ctx.loopsCompletedByModel.keys()]);
  for (const model of allModelKeys) {
    const started = ctx.loopsStartedByModel.get(model) ?? 0;
    const completed = ctx.loopsCompletedByModel.get(model) ?? 0;
    const totalActions = ctx.totalLoopActionsByModel.get(model) ?? 0;
    const totalDurationMs = ctx.autonomousDurationByModel.get(model) ?? 0;
    const dist = ctx.loopDistributionByModel.get(model) ?? {
      bucket1: 0,
      bucket2: 0,
      bucket3to5: 0,
      bucket6to10: 0,
      bucket11plus: 0,
    };
    ctx.agenticDepthByModel.set(model, {
      loopDistribution: dist,
      avgLoopActions: completed > 0 ? totalActions / completed : 0,
      completionRate: started > 0 ? (completed / started) * 100 : 0,
      velocityMsPerAction: totalActions > 0 ? totalDurationMs / totalActions : 0,
    });
  }

  const allDateKeys = new Set([...ctx.loopsStartedByDate.keys(), ...ctx.loopsCompletedByDate.keys()]);
  for (const date of allDateKeys) {
    const started = ctx.loopsStartedByDate.get(date) ?? 0;
    const completed = ctx.loopsCompletedByDate.get(date) ?? 0;
    const totalActions = ctx.totalLoopActionsByDate.get(date) ?? 0;
    const totalDurationMs = ctx.autonomousDurationByDate.get(date) ?? 0;
    const dist = ctx.loopDistributionByDate.get(date) ?? {
      bucket1: 0,
      bucket2: 0,
      bucket3to5: 0,
      bucket6to10: 0,
      bucket11plus: 0,
    };
    ctx.byDateAgenticDepth.set(date, {
      loopDistribution: dist,
      avgLoopActions: completed > 0 ? totalActions / completed : 0,
      completionRate: started > 0 ? (completed / started) * 100 : 0,
      velocityMsPerAction: totalActions > 0 ? totalDurationMs / totalActions : 0,
    });
  }

  if (ctx.latencies.length > MAX_LATENCY_SAMPLES) {
    ctx.latencies = ctx.latencies.slice(-MAX_LATENCY_SAMPLES);
  }
  if (ctx.chatLatencies.length > MAX_LATENCY_SAMPLES) {
    ctx.chatLatencies = ctx.chatLatencies.slice(-MAX_LATENCY_SAMPLES);
  }

  if (ctx.latencies.length > 0) {
    ctx.latencies.sort((a, b) => a - b);
    ctx.latencyP50 = percentile(ctx.latencies, 0.5);
    ctx.latencyP95 = percentile(ctx.latencies, 0.95);
    ctx.latencyP99 = percentile(ctx.latencies, 0.99);
  }

  if (ctx.chatLatencies.length > 0) {
    ctx.chatLatencies.sort((a, b) => a - b);
    ctx.chatLatencyP50 = percentile(ctx.chatLatencies, 0.5);
    ctx.chatLatencyP95 = percentile(ctx.chatLatencies, 0.95);
  }

  // Read CLI usage data from ~/.copilot/session-state/*/events.jsonl
  try {
    const channel = getOutputChannel();
    const config = vscode.workspace.getConfiguration("copilot-insight");
    const cliLogPath = config.get<string>("cliLogPath") || undefined;
    const cliDefaultModel = config.get<string>("cliDefaultModel")?.trim() || "Copilot CLI";
    const cliResult = await readCliStats(cliLogPath, cliDefaultModel);
    for (const [date, stat] of cliResult.byDate) {
      const existing = ctx.cliByDate.get(date) ?? { prompts: 0, outputTokens: 0 };
      ctx.cliByDate.set(date, {
        prompts: existing.prompts + stat.prompts,
        outputTokens: existing.outputTokens + stat.outputTokens,
      });
    }
    ctx.cliTotalInteractions = cliResult.totalInteractions;
    // Merge CLI per-model interactions into subagentByModel and byChatModel so that
    // CLI models appear in "Autonomous Ratio by Model" and agentic charts.
    // CLI sessions are fully autonomous, so both maps receive the same count (ratio = 100%).
    for (const [model, count] of cliResult.interactionsByModel) {
      ctx.byChatModel.set(model, (ctx.byChatModel.get(model) ?? 0) + count);
      ctx.subagentByModel.set(model, (ctx.subagentByModel.get(model) ?? 0) + count);
    }
    // Merge prompt-length effectiveness buckets from CLI logs.
    for (const [bucket, counts] of Object.entries(cliResult.promptEffectiveness)) {
      const existing = ctx.promptEffectiveness[bucket] ?? { shown: 0, accepted: 0 };
      ctx.promptEffectiveness[bucket] = {
        shown: existing.shown + counts.shown,
        accepted: existing.accepted + counts.accepted,
      };
    }
    channel.appendLine(`CLI stats: ${ctx.cliTotalInteractions} interactions across ${cliResult.byDate.size} days`);
  } catch {
    // CLI stats are optional — never abort the main scan
  }

  return ctx;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Load all remaining (historical) Copilot log sessions and return a fresh
 * `CopilotUsageStats` that covers **all** available session directories.
 *
 * Intended to be called after an initial limited parse when the user
 * explicitly requests older data ("Load Historical Data").  Because this
 * performs a full re-parse, the returned stats supersede the earlier
 * partial result — callers should replace, not merge, their existing stats.
 */
export async function loadMoreCopilotLogs(logUri: vscode.Uri): Promise<CopilotUsageStats> {
  return parseCopilotLogs(logUri, { scanAllSessions: true });
}

/**
 * Read chat session title records and full session records from all
 * workspaceStorage roots derived from `logBaseDir` (plus any Windows /mnt/ roots).
 *
 * This is intentionally **not** called during the initial `parseCopilotLogs` scan
 * to keep the initial dashboard render fast.  Call this on demand — e.g. when the
 * Sessions tab is first opened — and feed the results to the DB worker before
 * calling `getSessionList()`.
 */
export async function readWorkspaceChatSessions(logBaseDir: string): Promise<{
  chatSessionTitles: ChatSessionTitleRecord[];
  chatSessions: ChatSessionRecord[];
}> {
  const wslRoot = resolveWorkspaceStorageRoot(logBaseDir);
  const winRoots = await discoverWindowsWorkspaceStorageRoots();
  const allRoots = [wslRoot, ...winRoots];

  // Merge title records from all roots, dedup by chatSessionId.
  const allTitleRecords = await Promise.all(allRoots.map((root) => readChatSessionTitleRecords(root)));
  const titleMap = new Map<string, ChatSessionTitleRecord>();
  for (const records of allTitleRecords) {
    for (const rec of records) {
      if (!titleMap.has(rec.chatSessionId)) {
        titleMap.set(rec.chatSessionId, rec);
      }
    }
  }
  const chatSessionTitles = [...titleMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Merge session records, dedup by chatSessionId (keep most-recent lastMessageAt).
  const allSessionRecords = await Promise.all(allRoots.map((root) => readChatSessionRecords(root)));
  const sessionMap = new Map<string, ChatSessionRecord>();
  for (const records of allSessionRecords) {
    for (const rec of records) {
      const existing = sessionMap.get(rec.chatSessionId);
      if (!existing) {
        sessionMap.set(rec.chatSessionId, rec);
        continue;
      }
      const existingLast = existing.lastMessageAt ? Date.parse(existing.lastMessageAt) : 0;
      const candidateLast = rec.lastMessageAt ? Date.parse(rec.lastMessageAt) : 0;
      sessionMap.set(rec.chatSessionId, candidateLast >= existingLast ? rec : existing);
    }
  }
  const chatSessions = [...sessionMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { chatSessionTitles, chatSessions };
}
