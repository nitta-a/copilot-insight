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
import type { CliDateStat } from "../types";
import { getPromptLengthBucket } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** In-process cache for CLI stats: invalidated when the session-state dir mtime changes. */
interface CliStatsCache {
  stats: CliStats;
  rootDir: string;
  dirMtimeMs: number;
}
let _cliStatsCache: CliStatsCache | null = null;

export interface CliStats {
  /** Per-date CLI interaction statistics (prompts + output tokens). */
  byDate: Map<string, CliDateStat>;
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

  // Check mtime-based in-memory cache: skip full scan when directory hasn't changed.
  try {
    const dirStat = await fs.stat(rootDir);
    if (_cliStatsCache && _cliStatsCache.rootDir === rootDir && _cliStatsCache.dirMtimeMs === dirStat.mtimeMs) {
      return _cliStatsCache.stats;
    }
  } catch {
    // rootDir doesn't exist — fall through to return empty stats
  }

  const byDate = new Map<string, CliDateStat>();
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
      const result = parseEventsJsonl(raw, defaultModel);

      // Merge per-date stats.
      for (const [dateKey, stat] of result.byDate) {
        const existing = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
        byDate.set(dateKey, {
          prompts: existing.prompts + stat.prompts,
          outputTokens: existing.outputTokens + stat.outputTokens,
        });
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

  const result: CliStats = {
    byDate,
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
    const dirStat = await fs.stat(rootDir);
    _cliStatsCache = { stats: result, rootDir, dirMtimeMs: dirStat.mtimeMs };
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

/**
 * Parse a single `events.jsonl` file content.
 *
 * Date key is derived from `session.start.data.startTime`.  If no
 * `session.start` event is found the date falls back to today.
 */
export function parseEventsJsonl(content: string, defaultModel = "Copilot CLI"): ParseResult {
  const byDate = new Map<string, CliDateStat>();
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

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = event.type as string | undefined;
    if (!type) {
      continue;
    }

    if (type === "session.start") {
      // Extract YYYY-MM-DD from the session start timestamp.
      const data = event.data as Record<string, unknown> | undefined;
      const startTime = data?.startTime as string | undefined;
      if (startTime && /^\d{4}-\d{2}-\d{2}/.test(startTime)) {
        dateKey = startTime.substring(0, 10);
      }
      // Extract optional session-level model name (e.g. "claude-opus-4.6").
      const model = data?.model as string | undefined;
      sessionModel = model?.trim() || defaultModel;
      // Reset pending bucket when a new session starts.
      pendingBucket = null;
      continue;
    }

    if (type === "user.message") {
      const data = event.data as Record<string, unknown> | undefined;
      const content = typeof data?.content === "string" ? data.content : "";
      const bucket = getPromptLengthBucket(content.length);

      // If a prior user message was never answered, it still counts as shown.
      // (The pending bucket was already incremented as "shown" below.)

      // Increment shown for this bucket.
      const current = promptEffectiveness[bucket] ?? { shown: 0, accepted: 0 };
      promptEffectiveness[bucket] = { shown: current.shown + 1, accepted: current.accepted };

      // Record pending bucket for the next assistant.message.
      pendingBucket = bucket;

      const dateStat = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
      byDate.set(dateKey, { ...dateStat, prompts: dateStat.prompts + 1 });
      totalInteractions++;
      continue;
    }

    if (type === "assistant.message") {
      const data = event.data as Record<string, unknown> | undefined;
      const outputTokens = typeof data?.outputTokens === "number" ? data.outputTokens : 0;
      if (outputTokens > 0) {
        const dateStat = byDate.get(dateKey) ?? { prompts: 0, outputTokens: 0 };
        byDate.set(dateKey, { ...dateStat, outputTokens: dateStat.outputTokens + outputTokens });

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

  return {
    byDate,
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
