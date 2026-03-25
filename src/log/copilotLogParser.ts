import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import type { ChatSessionRecord, ChatSessionTitleRecord, CopilotUsageStats, ParsingContext } from "../types";
import { resolveLogSearchPaths } from "../utils/logPaths";
import {
  discoverWindowsWorkspaceStorageRoots,
  readAllChatSessionData,
  resolveWorkspaceStorageRoot,
} from "./chatSessionTitleReader";
import { readCliStats } from "./cliLogReader";
import { getLogChannel, isTimingLogsEnabled } from "./logChannel";
import {
  findCopilotDirs,
  getAllSessionDirs,
  getSortedSessionDirs,
  parseLogDirectory,
  parseRemoteExthostLog,
  parseSessionTerminalLog,
} from "./logFileReader";

export type { CopilotUsageStats, DateStat } from "../types";

// ---------------------------------------------------------------------------
// Workspace session cache (disk)
// ---------------------------------------------------------------------------

const WS_SESSION_CACHE_FILENAME = "ws-session-cache.json";
/** Default TTL for the workspace session disk cache: 15 minutes. */
const WS_SESSION_CACHE_TTL_MS = 15 * 60 * 1000;

interface WsSessionCacheFile {
  version: 1;
  cachedAt: string;
  chatSessionTitles: ChatSessionTitleRecord[];
  chatSessions: ChatSessionRecord[];
}

async function loadWsSessionCache(
  storagePath: string,
  ttlMs: number,
): Promise<{ chatSessionTitles: ChatSessionTitleRecord[]; chatSessions: ChatSessionRecord[] } | null> {
  try {
    const cacheFile = path.join(storagePath, WS_SESSION_CACHE_FILENAME);
    const raw = await fs.readFile(cacheFile, "utf8");
    const cache = JSON.parse(raw) as WsSessionCacheFile;
    if (cache.version !== 1 || !cache.cachedAt) {
      return null;
    }
    if (Date.now() - Date.parse(cache.cachedAt) > ttlMs) {
      return null;
    }
    return { chatSessionTitles: cache.chatSessionTitles ?? [], chatSessions: cache.chatSessions ?? [] };
  } catch {
    return null;
  }
}

async function saveWsSessionCache(
  storagePath: string,
  chatSessionTitles: ChatSessionTitleRecord[],
  chatSessions: ChatSessionRecord[],
): Promise<void> {
  try {
    await fs.mkdir(storagePath, { recursive: true });
    const cache: WsSessionCacheFile = {
      version: 1,
      cachedAt: new Date().toISOString(),
      chatSessionTitles,
      chatSessions,
    };
    await fs.writeFile(path.join(storagePath, WS_SESSION_CACHE_FILENAME), JSON.stringify(cache));
  } catch {
    // Non-fatal — cache is best-effort.
  }
}

export interface ParseCopilotLogsOptions {
  scanAllSessions?: boolean;
  /**
   * Maximum number of sessions to parse.  When set, only the most recent
   * `limitSessions` session directories are processed, enabling fast initial
   * dashboard loads.  Ignored when `scanAllSessions` is true.
   */
  limitSessions?: number;
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
    cliToolExecutions: new Map(),
    cliReasoningTokens: 0,
    cliAgentTypes: new Map(),
    commandUsage: new Map(),
    promptEffectiveness: {},
    chatSessionStates: new Map(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    tokensByModel: new Map(),
    finishReasonCounts: new Map(),
  };

  const channel = getLogChannel();
  const timingEnabled = isTimingLogsEnabled();
  const parseStartMs = timingEnabled ? performance.now() : 0;
  if (timingEnabled) {
    channel.appendLine(`[TIMING] parseCopilotLogs start | logUri: ${logUri.fsPath}`);
  }

  try {
    // Locate the VS Code session root by splitting fsPath on the native
    // separator and finding the `logs` landmark segment — depth-independent
    // and correct on both macOS ('/') and Windows ('\').
    let phaseStartMs = timingEnabled ? performance.now() : 0;
    const { sessionRoot, logBaseDir, fallbackSessionDir } = resolveLogSearchPaths(logUri.fsPath);
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] resolveLogSearchPaths: ${(performance.now() - phaseStartMs).toFixed(1)}ms | ` +
          (sessionRoot ? `session root: ${sessionRoot}` : "session root: not found"),
      );
    }
    if (!sessionRoot) {
      channel.appendLine(`Warning: could not detect session root from ${logUri.fsPath}; using inferred fallback`);
    }

    channel.appendLine(`Searching for logs in: ${logBaseDir}`);

    if (timingEnabled) {
      phaseStartMs = performance.now();
    }
    const sessionDirs = options?.scanAllSessions
      ? await getAllSessionDirs(logBaseDir, fallbackSessionDir)
      : await getSortedSessionDirs(logBaseDir, fallbackSessionDir, { limit: options?.limitSessions });
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] ${options?.scanAllSessions ? "getAllSessionDirs" : "getSortedSessionDirs"}: ` +
          `${(performance.now() - phaseStartMs).toFixed(1)}ms | found ${sessionDirs.length} session(s)`,
      );
    }

    // Process all session directories in parallel. Note: ctx.currentSessionId is
    // shared state set per-session below; when sessions run concurrently it acts
    // as a best-effort fallback — most log lines embed their own session ID in
    // the JSON payload and do not rely on this field.
    const sessionsStartMs = timingEnabled ? performance.now() : 0;
    await Promise.all(
      sessionDirs.map(async (sessDir) => {
        try {
          ctx.currentSessionId = path.basename(sessDir);
          const sessionStartMs = timingEnabled ? performance.now() : 0;
          channel.appendLine(`Scanning session: ${sessDir}`);

          let sessionPhaseMs = timingEnabled ? performance.now() : 0;
          const copilotDirs = await findCopilotDirs(sessDir);
          if (timingEnabled) {
            channel.appendLine(
              `[TIMING]   findCopilotDirs: ${(performance.now() - sessionPhaseMs).toFixed(1)}ms | ${copilotDirs.length} dir(s)`,
            );
          }
          if (copilotDirs.length === 0) {
            channel.appendLine(`  Skipped: no GitHub Copilot log directories found in ${sessDir}`);
          }

          if (timingEnabled) {
            sessionPhaseMs = performance.now();
          }
          for (const copilotLogDir of copilotDirs) {
            channel.appendLine(`  Found Copilot log dir: ${copilotLogDir}`);
            const beforeFiles = ctx.logFilesFound;
            await parseLogDirectory(copilotLogDir, ctx);
            channel.appendLine(`    Parsed ${ctx.logFilesFound - beforeFiles} file(s)`);
          }
          if (timingEnabled) {
            channel.appendLine(
              `[TIMING]   parseLogDirectories: ${(performance.now() - sessionPhaseMs).toFixed(1)}ms (${copilotDirs.length} copilot dir(s))`,
            );
          }

          if (timingEnabled) {
            sessionPhaseMs = performance.now();
          }
          const terminalLogParsed = await parseSessionTerminalLog(sessDir, ctx);
          if (timingEnabled) {
            channel.appendLine(
              `[TIMING]   parseSessionTerminalLog: ${(performance.now() - sessionPhaseMs).toFixed(1)}ms | ${terminalLogParsed ? "parsed" : "missing/unreadable"}`,
            );
          }

          if (timingEnabled) {
            sessionPhaseMs = performance.now();
          }
          // Also parse all .log files inside exthost<N>/ subdirectories — present in
          // VS Code Remote / WSL sessions; contains MCP and agentic-loop signals.
          const exthostResult = await parseRemoteExthostLog(sessDir, ctx);
          if (timingEnabled) {
            channel.appendLine(
              `[TIMING]   parseRemoteExthostLog: ${(performance.now() - sessionPhaseMs).toFixed(1)}ms | ${exthostResult.matchedDirs} dir(s), ${exthostResult.parsedFiles} file(s)`,
            );
            channel.appendLine(
              `[TIMING] session total: ${(performance.now() - sessionStartMs).toFixed(1)}ms | ${path.basename(sessDir)}`,
            );
          }
        } catch {
          // Skip unreadable session directories
          channel.appendLine(`  Skipped: could not read session directory ${sessDir}`);
        }
      }),
    );
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] all sessions: ${(performance.now() - sessionsStartMs).toFixed(1)}ms | logFilesFound=${ctx.logFilesFound}, shown=${ctx.totalShown}, accepted=${ctx.totalAccepted}, chat=${ctx.totalChat}`,
      );
    }
    // NOTE: SQLite workspace chat-session reads are intentionally deferred.
    // Call readWorkspaceChatSessions(logBaseDir) on demand (e.g. when the
    // Sessions tab is first opened) to avoid blocking the initial parse.
  } catch (e) {
    console.error("Error parsing Copilot logs:", e instanceof Error ? e.message : "unknown error");
  }

  const postProcessStartMs = timingEnabled ? performance.now() : 0;
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

  if (timingEnabled) {
    channel.appendLine(`[TIMING] post-processing: ${(performance.now() - postProcessStartMs).toFixed(1)}ms`);
  }

  // Read CLI usage data from ~/.copilot/session-state/*/events.jsonl
  try {
    const cliStartMs = timingEnabled ? performance.now() : 0;
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
    for (const [toolName, counts] of cliResult.toolExecutions) {
      const existing = ctx.cliToolExecutions?.get(toolName) ?? { total: 0, success: 0, fail: 0 };
      ctx.cliToolExecutions?.set(toolName, {
        total: existing.total + counts.total,
        success: existing.success + counts.success,
        fail: existing.fail + counts.fail,
      });
    }
    ctx.cliReasoningTokens = (ctx.cliReasoningTokens ?? 0) + cliResult.reasoningTokens;
    for (const [agentName, count] of cliResult.agentTypes) {
      ctx.cliAgentTypes?.set(agentName, (ctx.cliAgentTypes?.get(agentName) ?? 0) + count);
    }
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
    if (timingEnabled) {
      channel.appendLine(
        `[TIMING] readCliStats: ${(performance.now() - cliStartMs).toFixed(1)}ms | ${ctx.cliTotalInteractions} interactions across ${cliResult.byDate.size} days`,
      );
    }
  } catch {
    // CLI stats are optional — never abort the main scan
  }

  if (timingEnabled) {
    channel.appendLine(`[TIMING] parseCopilotLogs total: ${(performance.now() - parseStartMs).toFixed(1)}ms`);
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
export async function readWorkspaceChatSessions(
  logBaseDir: string,
  options?: { skipWindowsRoots?: boolean; storagePath?: string; cacheTtlMs?: number },
): Promise<{
  chatSessionTitles: ChatSessionTitleRecord[];
  chatSessions: ChatSessionRecord[];
}> {
  const channel = getLogChannel();
  const timingEnabled = isTimingLogsEnabled();
  const t0 = timingEnabled ? performance.now() : 0;

  // Fast path: return cached results when available and within TTL.
  if (options?.storagePath) {
    const ttl = options.cacheTtlMs ?? WS_SESSION_CACHE_TTL_MS;
    const cached = await loadWsSessionCache(options.storagePath, ttl);
    if (cached) {
      if (timingEnabled) {
        channel.appendLine(
          `[TIMING] readWorkspaceChatSessions: cache hit (${(performance.now() - t0).toFixed(1)}ms) | titles=${cached.chatSessionTitles.length}, sessions=${cached.chatSessions.length}`,
        );
      }
      return cached;
    }
  }

  const wslRoot = resolveWorkspaceStorageRoot(logBaseDir);
  const winRoots = options?.skipWindowsRoots ? [] : await discoverWindowsWorkspaceStorageRoots();
  const allRoots = [wslRoot, ...winRoots];
  if (timingEnabled) {
    channel.appendLine(
      `[TIMING] readWorkspaceChatSessions.discoverRoots: ${(performance.now() - t0).toFixed(1)}ms | roots=${allRoots.length}, skipWindowsRoots=${options?.skipWindowsRoots ?? false}`,
    );
  }

  const t1 = timingEnabled ? performance.now() : 0;
  // Single-pass: scan each root once, deriving title records from session records.
  const allResults = await Promise.all(allRoots.map((root) => readAllChatSessionData(root)));
  if (timingEnabled) {
    const totalFiles = allResults.reduce((s, r) => s + r.sessionRecords.length, 0);
    channel.appendLine(
      `[TIMING] readWorkspaceChatSessions.scanRoots: ${(performance.now() - t1).toFixed(1)}ms | sessions=${totalFiles}`,
    );
  }

  // Merge across roots, dedup by chatSessionId.
  const titleMap = new Map<string, ChatSessionTitleRecord>();
  const sessionMap = new Map<string, ChatSessionRecord>();

  for (const { titleRecords, sessionRecords } of allResults) {
    for (const rec of titleRecords) {
      if (!titleMap.has(rec.chatSessionId)) {
        titleMap.set(rec.chatSessionId, rec);
      }
    }
    for (const rec of sessionRecords) {
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

  const chatSessionTitles = [...titleMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const chatSessions = [...sessionMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (timingEnabled) {
    channel.appendLine(
      `[TIMING] readWorkspaceChatSessions total: ${(performance.now() - t0).toFixed(1)}ms | ` +
        `titles=${chatSessionTitles.length}, sessions=${chatSessions.length}`,
    );
  }

  // Persist results to disk for fast retrieval on next open.
  if (options?.storagePath) {
    void saveWsSessionCache(options.storagePath, chatSessionTitles, chatSessions);
  }

  return { chatSessionTitles, chatSessions };
}
