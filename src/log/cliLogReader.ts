/**
 * CLI log reader — discovers and parses GitHub Copilot CLI session logs stored
 * as JSONL files under `~/.copilot/session-state/<uuid>/events.jsonl`.
 *
 * Each session file contains one JSON event per line.  The events relevant to
 * usage statistics are:
 *
 *   {"type":"session.start","data":{"startTime":"2026-03-14T04:02:16.445Z", ...}}
 *   {"type":"user.message","data":{...}}
 *   {"type":"assistant.message","data":{"outputTokens": 927, ...}}
 *
 * Errors in individual files are silently swallowed (same convention as the
 * VS Code log parsers) so that a corrupt or partially written file does not
 * abort the entire scan.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CliDateStat, CliThreadUsage, CliUsageStat, CliUsageTurn } from "../types";
import { getPromptLengthBucket } from "../types";
import { parseFusion } from "./fusion";
import { parseInterventions } from "./interventions";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** In-process cache for CLI stats: invalidated when any session event file changes. */
interface CliStatsCache {
  stats: CliStats;
  rootDir: string;
  signature: string;
  defaultModel: string;
}
let _cliStatsCache: CliStatsCache | null = null;

async function getCacheSignature(rootDir: string): Promise<string> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const signatures = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const eventsPath = path.join(rootDir, entry.name, "events.jsonl");
        try {
          const stat = await fs.stat(eventsPath);
          return `${entry.name}:${stat.size}:${stat.mtimeMs}`;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            return `${entry.name}:missing`;
          }
          return `${entry.name}:${code ?? "error"}`;
        }
      }),
  );
  return signatures.sort().join("|");
}

export interface CliStats {
  /** Per-date CLI interaction statistics (prompts + output tokens). */
  byDate: Map<string, CliDateStat>;
  /** Aggregated CLI token and AI credit usage. */
  usage: CliUsageStat;
  /** Per-model CLI token and AI credit usage. */
  usageByModel: Map<string, CliUsageStat>;
  threads: CliThreadUsage[];
  /** Total number of CLI prompt interactions across all scanned sessions. */
  totalInteractions: number;
  /** Number of assistant-turn interactions attributed to each model name. */
  interactionsByModel: Map<string, number>;
  /**
   * Prompt-length effectiveness buckets accumulated from all scanned sessions.
   * Keys are bucket labels (e.g. "0-50"); values hold shown/accepted counts.
   */
  promptEffectiveness: Record<string, { shown: number; accepted: number }>;
  /** Tool execution stats by tool name: total calls, successes, and failures. */
  toolExecutions: Map<string, { total: number; success: number; fail: number }>;
  /** Per-tool, per-model call counts (tool name → model name → count). */
  toolModelUsage: Map<string, Map<string, number>>;
  /** Total length of reasoning text observed across all sessions (proxy for thinking depth). */
  reasoningTokens: number;
  /** Subagent type counts keyed by agentName from subagent.started events. */
  agentTypes: Map<string, number>;
  /** Total number of assistant turns counted across all sessions. */
  turnCount: number;
  /** Number of session model-change events observed. */
  modelChanges: number;
}

/**
 * Scan the Copilot CLI session-state directory and return aggregated usage
 * statistics keyed by ISO date string (YYYY-MM-DD).
 *
 * @param cliLogDir  Root directory to scan.  Defaults to
 *                   `~/.copilot/session-state/`.  Pass an explicit path (e.g.
 *                   from the `copilot-insight.cliLogPath` VS Code setting) to
 *                   override auto-discovery.
 */
export async function readCliStats(cliLogDir?: string, defaultModel = "Copilot CLI"): Promise<CliStats> {
  const rootDir = cliLogDir?.trim() ? cliLogDir.trim() : path.join(os.homedir(), ".copilot", "session-state");

  let cacheSignature: string | undefined;
  try {
    cacheSignature = await getCacheSignature(rootDir);
    if (
      _cliStatsCache &&
      _cliStatsCache.rootDir === rootDir &&
      _cliStatsCache.signature === cacheSignature &&
      _cliStatsCache.defaultModel === defaultModel
    ) {
      return _cliStatsCache.stats;
    }
  } catch {
    // rootDir doesn't exist — fall through to return empty stats
  }

  const byDate = new Map<string, CliDateStat>();
  const usage = emptyUsage();
  const usageByModel = new Map<string, CliUsageStat>();
  const threads: CliThreadUsage[] = [];
  const interventionSources = new Map<string, string[]>();
  const interactionsByModel = new Map<string, number>();
  let totalInteractions = 0;
  const promptEffectiveness: Record<string, { shown: number; accepted: number }> = {};
  const toolExecutions = new Map<string, { total: number; success: number; fail: number }>();
  const toolModelUsage = new Map<string, Map<string, number>>();
  let reasoningTokens = 0;
  const agentTypes = new Map<string, number>();
  let turnCount = 0;
  let modelChanges = 0;

  let sessionDirs: string[];
  try {
    const entries = await fs.readdir(rootDir);
    sessionDirs = entries.map((e) => path.join(rootDir, e));
  } catch {
    // Directory does not exist — CLI not installed or never used.
    return {
      byDate,
      usage,
      usageByModel,
      threads,
      totalInteractions,
      interactionsByModel,
      promptEffectiveness,
      toolExecutions,
      toolModelUsage,
      reasoningTokens,
      agentTypes,
      turnCount,
      modelChanges,
    };
  }

  for (const sessionDir of sessionDirs) {
    const eventsPath = path.join(sessionDir, "events.jsonl");
    try {
      const raw = await fs.readFile(eventsPath, "utf8");
      const result = parseEventsJsonl(raw, defaultModel, path.basename(sessionDir));

      if (result.thread) {
        const sources = interventionSources.get(result.thread.sessionId) ?? [];
        sources.push(raw);
        interventionSources.set(result.thread.sessionId, sources);
      }

      // Merge per-date stats.
      for (const [dateKey, stat] of result.byDate) {
        const existing = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
        byDate.set(dateKey, {
          prompts: existing.prompts + stat.prompts,
          outputTokens: existing.outputTokens + stat.outputTokens,
          ...(existing.usage || stat.usage
            ? { usage: stat.usage ? addUsage(existing.usage, stat.usage) : existing.usage }
            : {}),
        });
      }
      addUsageInPlace(usage, result.usage);
      for (const [model, modelUsage] of result.usageByModel) {
        usageByModel.set(model, addUsage(usageByModel.get(model), modelUsage));
      }
      if (
        result.thread &&
        (Boolean(result.thread.fusionRuns?.length) ||
          Boolean(result.thread.interventions?.permissions.length || result.thread.interventions?.steering.length || result.thread.interventions?.stops.length) ||
          result.totalInteractions > 0 ||
          result.usage.inputTokens > 0 ||
          result.usage.outputTokens > 0 ||
          result.usage.cacheReadTokens > 0 ||
          result.usage.cacheWriteTokens > 0 ||
          result.usage.reasoningTokens > 0 ||
          result.usage.totalNanoAiu === null ||
          (result.usage.totalNanoAiu ?? 0) > 0)
      ) {
        threads.push(result.thread);
      }
      totalInteractions += result.totalInteractions;
      // Merge per-model counts.
      for (const [model, count] of result.interactionsByModel) {
        interactionsByModel.set(model, (interactionsByModel.get(model) ?? 0) + count);
      }
      // Merge prompt-length effectiveness buckets.
      for (const [bucket, counts] of Object.entries(result.promptEffectiveness)) {
        const existing = promptEffectiveness[bucket] ?? { shown: 0, accepted: 0 };
        promptEffectiveness[bucket] = {
          shown: existing.shown + counts.shown,
          accepted: existing.accepted + counts.accepted,
        };
      }
      // Merge tool execution stats.
      for (const [toolName, counts] of result.toolExecutions) {
        const existing = toolExecutions.get(toolName) ?? { total: 0, success: 0, fail: 0 };
        toolExecutions.set(toolName, {
          total: existing.total + counts.total,
          success: existing.success + counts.success,
          fail: existing.fail + counts.fail,
        });
      }
      // Merge per-tool model usage.
      for (const [toolName, modelMap] of result.toolModelUsage) {
        const existingModelMap = toolModelUsage.get(toolName) ?? new Map<string, number>();
        for (const [model, count] of modelMap) {
          existingModelMap.set(model, (existingModelMap.get(model) ?? 0) + count);
        }
        toolModelUsage.set(toolName, existingModelMap);
      }
      reasoningTokens += result.reasoningTokens;
      for (const [agentName, count] of result.agentTypes) {
        agentTypes.set(agentName, (agentTypes.get(agentName) ?? 0) + count);
      }
      turnCount += result.turnCount;
      modelChanges += result.modelChanges;
    } catch {
      // Skip unreadable or missing files.
    }
  }

  const seenInterventionEvents = new Set<string>();
  const assignedSessions = new Set<string>();
  for (const thread of threads) {
    if (assignedSessions.has(thread.sessionId)) {
      thread.interventions = undefined;
      continue;
    }
    assignedSessions.add(thread.sessionId);
    thread.interventions = parseInterventions((interventionSources.get(thread.sessionId) ?? []).join("\n"), seenInterventionEvents);
  }

  const result: CliStats = {
    byDate,
    usage,
    usageByModel,
    threads,
    totalInteractions,
    interactionsByModel,
    promptEffectiveness,
    toolExecutions,
    toolModelUsage,
    reasoningTokens,
    agentTypes,
    turnCount,
    modelChanges,
  };

  // Update in-memory cache.
  try {
    const endSignature = await getCacheSignature(rootDir);
    // A session can grow while being read; never cache that partial scan as up to date.
    if (cacheSignature === endSignature) {
      _cliStatsCache = { stats: result, rootDir, signature: endSignature, defaultModel };
    }
  } catch {
    // Non-fatal — cache will simply be absent.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParseResult {
  byDate: Map<string, CliDateStat>;
  usage: CliUsageStat;
  usageByModel: Map<string, CliUsageStat>;
  thread?: CliThreadUsage;
  totalInteractions: number;
  interactionsByModel: Map<string, number>;
  promptEffectiveness: Record<string, { shown: number; accepted: number }>;
  toolExecutions: Map<string, { total: number; success: number; fail: number }>;
  toolModelUsage: Map<string, Map<string, number>>;
  reasoningTokens: number;
  agentTypes: Map<string, number>;
  turnCount: number;
  modelChanges: number;
}

function emptyUsage(): CliUsageStat {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalNanoAiu: 0,
  };
}

export function addUsage(left: CliUsageStat | undefined, right: CliUsageStat): CliUsageStat {
  const result = left ? { ...left } : emptyUsage();
  addUsageInPlace(result, right);
  return result;
}

function addUsageInPlace(target: CliUsageStat, value: CliUsageStat): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cacheReadTokens += value.cacheReadTokens;
  target.cacheWriteTokens += value.cacheWriteTokens;
  target.reasoningTokens += value.reasoningTokens;
  target.totalNanoAiu =
    target.totalNanoAiu === null || value.totalNanoAiu === null ? null : target.totalNanoAiu + value.totalNanoAiu;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function creditAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageFromMetrics(value: unknown, fallback = emptyUsage()): CliUsageStat {
  const metrics = asRecord(value);
  return {
    inputTokens: metrics?.inputTokens === undefined ? fallback.inputTokens : nonNegativeNumber(metrics.inputTokens),
    outputTokens: metrics?.outputTokens === undefined ? fallback.outputTokens : nonNegativeNumber(metrics.outputTokens),
    cacheReadTokens:
      metrics?.cacheReadTokens === undefined ? fallback.cacheReadTokens : nonNegativeNumber(metrics.cacheReadTokens),
    cacheWriteTokens:
      metrics?.cacheWriteTokens === undefined ? fallback.cacheWriteTokens : nonNegativeNumber(metrics.cacheWriteTokens),
    reasoningTokens:
      metrics?.reasoningTokens === undefined ? fallback.reasoningTokens : nonNegativeNumber(metrics.reasoningTokens),
    totalNanoAiu: fallback.totalNanoAiu,
  };
}

function eventTimestamp(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

/**
 * Parse a single `events.jsonl` file content.
 *
 * Daily usage uses the model-call timestamp in UTC. Cumulative snapshots
 * update thread totals only: their reconciliation delta has no known call date.
 */
export function parseEventsJsonl(content: string, defaultModel = "Copilot CLI", fallbackSessionId = ""): ParseResult {
  const byDate = new Map<string, CliDateStat>();
  const usage = emptyUsage();
  const usageByModel = new Map<string, CliUsageStat>();
  const usageByDate = new Map<string, CliUsageStat>();
  const seenUsageIds = new Set<string>();
  const usageWatermarks = new Map<string, number>();
  const turns: CliUsageTurn[] = [];
  let currentTurn: CliUsageTurn | undefined;
  let currentTurnHasUsage = false;
  let sessionId = fallbackSessionId;
  let projectPath: string | null = null;
  let sawSessionStart = false;
  let title = "";
  let startedAt: string | null = null;
  let lastActivityAt: string | null = null;
  let hasDetailedUsage = false;
  let hasTokenUsage = false;
  let legacyOutputTokens = 0;
  const interactionsByModel = new Map<string, number>();
  let totalInteractions = 0;
  const promptEffectiveness: Record<string, { shown: number; accepted: number }> = {};
  const toolExecutions = new Map<string, { total: number; success: number; fail: number }>();
  const toolModelUsage = new Map<string, Map<string, number>>();
  let reasoningTokens = 0;
  const agentTypes = new Map<string, number>();
  let turnCount = 0;
  let modelChanges = 0;

  // Derive today's date as a fallback (YYYY-MM-DD in UTC).
  const todayKey = new Date().toISOString().substring(0, 10);
  let dateKey = todayKey;
  // Model for the current session (from session.start or overridden per turn).
  let sessionModel = defaultModel;
  // Track the bucket of the most recent user.message awaiting an assistant response.
  let pendingBucket: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let event: Record<string, unknown> | undefined;
    try {
      event = asRecord(JSON.parse(trimmed));
    } catch {
      continue;
    }

    const type = event?.type;
    if (!event || typeof type !== "string") {
      continue;
    }
    const timestamp = eventTimestamp(event.timestamp);
    if (timestamp) {
      startedAt ??= timestamp;
      if (timestamp.localeCompare(lastActivityAt ?? "") > 0) {
        lastActivityAt = timestamp;
      }
    }
    if (!type) {
      continue;
    }

    if (type === "session.start") {
      // Extract YYYY-MM-DD from the session start timestamp.
      const data = asRecord(event.data);
      if (!sawSessionStart) {
        sawSessionStart = true;
        const context = asRecord(data?.context);
        const folder = [context?.gitRoot, context?.cwd].find(
          (value): value is string => typeof value === "string" && path.isAbsolute(value),
        );
        projectPath = folder ? path.normalize(folder) : null;
      }
      const startTime = eventTimestamp(data?.startTime);
      if (startTime && /^\d{4}-\d{2}-\d{2}/.test(startTime)) {
        dateKey = startTime.substring(0, 10);
        if (!startedAt || startTime < startedAt) {
          startedAt = startTime;
        }
      }
      sessionId = typeof data?.sessionId === "string" ? data.sessionId : sessionId;
      if (typeof data?.title === "string") {
        title = data.title.slice(0, 160);
      }
      // Extract optional session-level model name (e.g. "claude-opus-4.6").
      const model = data?.model ?? data?.selectedModel;
      sessionModel = typeof model === "string" && model.trim() ? model.trim() : defaultModel;
      // Reset pending bucket when a new session starts.
      pendingBucket = null;
      currentTurn = undefined;
      currentTurnHasUsage = false;
      continue;
    }

    if (type === "session.title_changed") {
      const data = asRecord(event.data);
      if (typeof data?.title === "string" && data.title.trim()) {
        title = data.title.trim().slice(0, 160);
      }
      continue;
    }

    if (type === "session.usage_record") {
      const data = asRecord(event.data);
      const record = asRecord(data?.usage);
      if (record) {
        const accounting = asRecord(record.accounting);
        const usageId = accounting?.usageId;
        const sourceSessionId = accounting?.sourceSessionId;
        const sequence = accounting?.sequence;
        const dedupeId =
          typeof usageId === "string" && typeof sourceSessionId === "string"
            ? `${sourceSessionId}:${usageId}`
            : typeof sourceSessionId === "string" && typeof sequence === "number"
              ? `${sourceSessionId}:${sequence}`
              : typeof event.id === "string"
                ? event.id
                : undefined;
        if (!dedupeId || !seenUsageIds.has(dedupeId)) {
          if (dedupeId) {
            seenUsageIds.add(dedupeId);
          }
          const recordUsage: CliUsageStat = {
            inputTokens: nonNegativeNumber(record.inputTokens),
            outputTokens: nonNegativeNumber(record.outputTokens),
            cacheReadTokens: nonNegativeNumber(record.cacheReadTokens),
            cacheWriteTokens: nonNegativeNumber(record.cacheWriteTokens),
            reasoningTokens: nonNegativeNumber(record.reasoningTokens),
            totalNanoAiu:
              record.aiCreditsStatus === undefined || record.aiCreditsStatus === "complete"
                ? creditAmount(asRecord(record.copilotUsage)?.totalNanoAiu)
                : null,
          };
          hasDetailedUsage = true;
          hasTokenUsage = true;
          if (timestamp) {
            const usageDate = timestamp.slice(0, 10);
            usageByDate.set(usageDate, addUsage(usageByDate.get(usageDate), recordUsage));
          }
          const model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : sessionModel;
          const alreadyInSnapshot =
            typeof sourceSessionId === "string" &&
            typeof sequence === "number" &&
            sequence <= (usageWatermarks.get(sourceSessionId) ?? -1);
          if (!alreadyInSnapshot) {
            addUsageInPlace(usage, recordUsage);
            usageByModel.set(model, addUsage(usageByModel.get(model), recordUsage));
            if (currentTurn) {
              currentTurn.usage = currentTurnHasUsage ? addUsage(currentTurn.usage, recordUsage) : { ...recordUsage };
              currentTurnHasUsage = true;
            }
          }
        }
      }
      continue;
    }

    if (type === "session.usage_checkpoint" || type === "session.shutdown") {
      const data = asRecord(event.data);
      const snapshot = asRecord(data?.accountingSnapshot) ?? data;
      if (snapshot) {
        const rawModelMetrics = asRecord(snapshot.modelMetrics);
        let hasModelMetrics = false;
        if (rawModelMetrics) {
          for (const [model, rawMetrics] of Object.entries(rawModelMetrics)) {
            const modelMetrics = asRecord(rawMetrics);
            if (!modelMetrics) {
              continue;
            }
            hasModelMetrics = true;
            if (asRecord(modelMetrics.usage)) {
              hasTokenUsage = true;
            }
            const previous = usageByModel.get(model) ?? emptyUsage();
            const modelUsage = usageFromMetrics(modelMetrics.usage, previous);
            modelUsage.totalNanoAiu =
              modelMetrics.aiCreditsStatus === undefined || modelMetrics.aiCreditsStatus === "complete"
                ? creditAmount(modelMetrics.totalNanoAiu)
                : null;
            for (const key of [
              "inputTokens",
              "outputTokens",
              "cacheReadTokens",
              "cacheWriteTokens",
              "reasoningTokens",
            ] as const) {
              usage[key] += modelUsage[key] - previous[key];
            }
            if (usage.totalNanoAiu !== null && modelUsage.totalNanoAiu !== null && previous.totalNanoAiu !== null) {
              usage.totalNanoAiu += modelUsage.totalNanoAiu - previous.totalNanoAiu;
            } else {
              usage.totalNanoAiu = null;
            }
            usageByModel.set(model, modelUsage);
          }
        }
        const totalNanoAiu = creditAmount(snapshot.totalNanoAiu);
        if (totalNanoAiu !== null || hasModelMetrics) {
          hasDetailedUsage = true;
          usage.totalNanoAiu = totalNanoAiu ?? usage.totalNanoAiu;
          if (snapshot.aiCreditsStatus !== undefined && snapshot.aiCreditsStatus !== "complete") {
            usage.totalNanoAiu = null;
          }
          for (const [source, sequence] of Object.entries(asRecord(data?.usageAccountingWatermarks) ?? {})) {
            if (typeof sequence === "number") {
              usageWatermarks.set(source, sequence);
            }
          }
        }
      }
      continue;
    }

    if (type === "user.message") {
      const data = event.data as Record<string, unknown> | undefined;
      const content = typeof data?.content === "string" ? data.content : "";
      currentTurn = {
        timestamp,
        prompt: content.replace(/\s+/g, " ").trim().slice(0, 160),
        usage: { ...emptyUsage(), totalNanoAiu: null },
      };
      currentTurnHasUsage = false;
      turns.push(currentTurn);
      if (!title && currentTurn.prompt) {
        title = currentTurn.prompt;
      }
      const bucket = getPromptLengthBucket(content.length);

      // If a prior user message was never answered, it still counts as shown.
      // (The pending bucket was already incremented as "shown" below.)

      // Increment shown for this bucket.
      const current = promptEffectiveness[bucket] ?? { shown: 0, accepted: 0 };
      promptEffectiveness[bucket] = { shown: current.shown + 1, accepted: current.accepted };

      // Record pending bucket for the next assistant.message.
      pendingBucket = bucket;

      const promptDate = timestamp?.slice(0, 10) ?? dateKey;
      const dateStat = byDate.get(promptDate) ?? { prompts: 0, outputTokens: 0 };
      byDate.set(promptDate, { ...dateStat, prompts: dateStat.prompts + 1 });
      totalInteractions++;
      continue;
    }

    if (type === "assistant.message") {
      const data = event.data as Record<string, unknown> | undefined;
      const outputTokens = typeof data?.outputTokens === "number" ? data.outputTokens : 0;
      if (outputTokens > 0) {
        legacyOutputTokens += outputTokens;
        const outputDate = timestamp?.slice(0, 10) ?? dateKey;
        const dateStat = byDate.get(outputDate) ?? { prompts: 0, outputTokens: 0 };
        byDate.set(outputDate, { ...dateStat, outputTokens: dateStat.outputTokens + outputTokens });

        // The preceding user.message was "accepted" (AI produced a response).
        if (pendingBucket !== null) {
          const existing = promptEffectiveness[pendingBucket] ?? { shown: 0, accepted: 0 };
          promptEffectiveness[pendingBucket] = { shown: existing.shown, accepted: existing.accepted + 1 };
          pendingBucket = null;
        }
      }
      // Attribute this turn to a model (prefer per-message field over session model).
      const turnModel = (data?.model as string | undefined)?.trim() || sessionModel;
      interactionsByModel.set(turnModel, (interactionsByModel.get(turnModel) ?? 0) + 1);
      // Accumulate reasoning text length as a proxy for thinking depth.
      const reasoningText = data?.reasoningText as string | undefined;
      if (reasoningText) {
        reasoningTokens += reasoningText.length;
      }
      continue;
    }

    if (type === "tool.execution_complete") {
      const data = event.data as Record<string, unknown> | undefined;
      const toolName = data?.toolName as string | undefined;
      const success = data?.success as boolean | undefined;
      const toolModel = (data?.model as string | undefined)?.trim() || sessionModel;
      if (toolName) {
        const existing = toolExecutions.get(toolName) ?? { total: 0, success: 0, fail: 0 };
        toolExecutions.set(toolName, {
          total: existing.total + 1,
          success: success ? existing.success + 1 : existing.success,
          fail: !success ? existing.fail + 1 : existing.fail,
        });
        // Track per-tool model usage.
        const modelMap = toolModelUsage.get(toolName) ?? new Map<string, number>();
        modelMap.set(toolModel, (modelMap.get(toolModel) ?? 0) + 1);
        toolModelUsage.set(toolName, modelMap);
      }
      continue;
    }

    if (type === "subagent.started") {
      const data = event.data as Record<string, unknown> | undefined;
      const agentName = data?.agentName as string | undefined;
      if (agentName) {
        agentTypes.set(agentName, (agentTypes.get(agentName) ?? 0) + 1);
      }
      continue;
    }

    if (type === "assistant.turn_start" || type === "assistant.turn_end") {
      if (type === "assistant.turn_start") {
        turnCount++;
      }
      continue;
    }

    if (type === "session.model_change") {
      modelChanges++;
      // Update session-level model for subsequent events.
      const data = event.data as Record<string, unknown> | undefined;
      const newModel = (data?.model as string | undefined)?.trim();
      if (newModel) {
        sessionModel = newModel;
      }
      continue;
    }
  }

  if (!hasTokenUsage) {
    usage.outputTokens = legacyOutputTokens;
  }
  if (!hasDetailedUsage) {
    usage.totalNanoAiu = legacyOutputTokens > 0 || totalInteractions > 0 ? null : 0;
    for (const turn of turns) {
      turn.usage.totalNanoAiu = null;
    }
  }
  for (const [date, dateUsage] of usageByDate) {
    const existing = byDate.get(date) ?? { prompts: 0, outputTokens: 0 };
    byDate.set(date, { ...existing, outputTokens: dateUsage.outputTokens, usage: dateUsage });
  }

  return {
    byDate,
    usage,
    usageByModel,
    thread: sessionId
      ? {
          sessionId,
          projectPath,
          usageByDate: Array.from(usageByDate, ([date, dailyUsage]) => ({ date, usage: dailyUsage })),
          title: title || `Copilot CLI ${sessionId.slice(0, 8)}`,
          startedAt,
          lastActivityAt,
          prompts: totalInteractions,
          usage,
          turns,
          fusionRuns: parseFusion(content),
          interventions: parseInterventions(content),
        }
      : undefined,
    totalInteractions,
    interactionsByModel,
    promptEffectiveness,
    toolExecutions,
    toolModelUsage,
    reasoningTokens,
    agentTypes,
    turnCount,
    modelChanges,
  };
}
