/**
 * Plain-text / ccreq log parser — handles non-JSON log lines produced by the
 * Copilot extension host, including `[fetchCompletions]`, `[AsyncCompletionManager]`,
 * and `ccreq:<hash> | ...` formatted entries.
 */

import type { ParsingContext } from "../../types";
import {
  classifyIntent,
  extractLineContext,
  extractTimestampFromText,
  incrementCount,
  incrementStatCount,
  isSubagentIntent,
  INTENT_DISPLAY_NAMES,
  KNOWN_CHAT_INTENTS,
  LineContext,
  maybeRecordFeatureSignals,
  normalizeModelName,
  pushSessionSignal,
  trackPlanningStats,
  trackSessionActivity,
  trackSessionError,
  recordCommandExecutionSignal,
} from "./parserHelpers";

// --- Sub-parsers for parseTextLogLine ---

/**
 * Parse "[fetchCompletions] ... finished with NNN status after NNNms" lines.
 * Returns true if the line was handled.
 */
function parseFetchCompletionsLine(
  line: string,
  { lower, dateKey, hourKey, timestamp }: LineContext,
  ctx: ParsingContext,
): boolean {
  if (!lower.includes("[fetchcompletions]") || !lower.includes("finished with")) {
    return false;
  }

  const statusMatch = line.match(/finished with (\d+) status/);
  const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;
  const latencyMatch = line.match(/after ([\d.]+)ms/);
  const latencyMs = latencyMatch ? Number.parseFloat(latencyMatch[1]) : 0;
  const engineMatch = line.match(/\/v1\/engines\/([\w.-]+)\/completions/);

  if (statusCode === 200) {
    ctx.totalShown++;
    if (dateKey) {
      incrementStatCount(ctx.byDate, dateKey, "shown");
    }
    if (hourKey) {
      incrementCount(ctx.byHour, hourKey);
    }
    if (engineMatch) {
      incrementStatCount(ctx.byModel, engineMatch[1], "shown");
    }
    if (latencyMs > 0) {
      ctx.latencySum += latencyMs;
      ctx.latencyCount++;
      ctx.latencies.push(latencyMs);
    }
    pushSessionSignal(ctx, {
      timestamp,
      signalType: "completion-shown",
      actor: "ai",
      phase: "execution",
      intent: "fetchCompletions",
      rawText: line,
      modelName: engineMatch?.[1] ?? "",
      latencyMs,
      success: true,
    });
  } else if (statusCode > 0) {
    ctx.totalErrors++;
    incrementCount(ctx.errorsByType, `HTTP ${statusCode}`);
  }

  trackSessionActivity(ctx, "shown");
  if (statusCode !== 200) {
    trackSessionError(ctx);
  }
  return true;
}

/**
 * Parse "[AsyncCompletionManager] ... AbortError" lines.
 * Returns true if the line was handled.
 */
function parseAbortErrorLine(line: string, lower: string, ctx: ParsingContext): boolean {
  if (line.includes("[AsyncCompletionManager]") && lower.includes("aborterror")) {
    ctx.totalRejected++;
    return true;
  }
  return false;
}

/** Extract and record the chat intent tag from a ccreq success line. */
function trackChatIntent(line: string, ctx: ParsingContext, model: string): string {
  const intentMatch = line.match(/\| \[([a-zA-Z0-9/\-]+)\]$/) ?? line.match(/\[([a-zA-Z0-9/\-]+)\]\s*$/);
  if (!intentMatch) {
    return "";
  }
  const rawIntent = intentMatch[1];
  if (KNOWN_CHAT_INTENTS.has(rawIntent)) {
    const displayName = INTENT_DISPLAY_NAMES[rawIntent] ?? rawIntent;
    incrementCount(ctx.byChatIntent, displayName);
  }
  // panel/unknown is the Copilot "Plan" mode intent: a plan was proposed.
  if (rawIntent === "panel/unknown") {
    ctx.planCount++;
    ctx.activePlanPending = true;
  }
  if (isSubagentIntent(rawIntent)) {
    // If a plan was pending execution, the first agentic request fulfils it.
    if (ctx.activePlanPending) {
      ctx.executedPlanCount++;
      ctx.activePlanPending = false;
    }
    ctx.subagentRequests++;
    // Extract the short intent name (e.g. "tool/runSubagent" → "runSubagent")
    const shortIntent = rawIntent.split("/").pop() ?? rawIntent;
    incrementCount(ctx.toolUsageStats, shortIntent);
    // Mark start of an agentic loop (use first request timestamp as start time)
    if (ctx.activeSubagentLoop === null) {
      const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
      if (tsMatch) {
        ctx.activeSubagentLoop = tsMatch[1];
        ctx.activeSubagentLoopModel = model ? model : null;
        ctx.subagentLoopsStarted++;
        incrementCount(ctx.loopsStartedByDate, tsMatch[1].slice(0, 10));
        ctx.activeSubagentLoopActionCount = 1;
        if (model) {
          incrementCount(ctx.loopsStartedByModel, model);
        }
      }
    } else {
      // Subsequent action in the currently active loop.
      ctx.activeSubagentLoopActionCount++;
    }
  }
  return rawIntent;
}

function recordInlineAccepted(
  ctx: ParsingContext,
  dateKey: string,
  hourKey: string,
  model: string,
  latency: number,
): void {
  ctx.totalAccepted++;
  if (dateKey) {
    incrementStatCount(ctx.byDate, dateKey, "accepted");
  }
  if (hourKey) {
    incrementCount(ctx.byHour, hourKey);
  }
  if (model) {
    incrementStatCount(ctx.byModel, model, "accepted");
  }
  if (latency > 0) {
    ctx.latencySum += latency;
    ctx.latencyCount++;
    ctx.latencies.push(latency);
  }
  trackSessionActivity(ctx, "accepted");
}

function recordChatRequest(
  ctx: ParsingContext,
  dateKey: string,
  hourKey: string,
  model: string,
  latency: number,
): void {
  ctx.totalChat++;
  if (dateKey) {
    incrementCount(ctx.chatByDate, dateKey);
  }
  if (hourKey) {
    incrementCount(ctx.chatByHour, hourKey);
  }
  if (model) {
    incrementCount(ctx.byChatModel, model);
  }
  if (latency > 0) {
    ctx.chatLatencySum += latency;
    ctx.chatLatencyCount++;
    ctx.chatLatencies.push(latency);
  }
  trackSessionActivity(ctx, "chat");
}

/**
 * Parse "ccreq:<hash> | success/error/timeout | ..." lines.
 * Returns true if the line was handled.
 */
function parseCcreqLine(
  line: string,
  { lower, dateKey, hourKey, timestamp }: LineContext,
  ctx: ParsingContext,
): boolean {
  if (!line.includes("ccreq:")) {
    return false;
  }

  const failMatch = line.match(/ccreq:\S+ \| (error|timeout|cancelled|failure) \|/i);
  if (failMatch) {
    ctx.totalErrors++;
    const errKey = failMatch[1].charAt(0).toUpperCase() + failMatch[1].slice(1).toLowerCase();
    incrementCount(ctx.errorsByType, errKey);
    trackSessionError(ctx);
    return true;
  }

  if (!line.includes("| success |")) {
    return true;
  }

  const ccreqMatch = line.match(/\| success \| ([\w./\- >]+?) \| (\d+)ms \|/);
  const model = normalizeModelName(ccreqMatch ? ccreqMatch[1] : "");
  const latency = ccreqMatch ? Number.parseInt(ccreqMatch[2], 10) : 0;

  const rawIntent = trackChatIntent(line, ctx, model);

  // Track per-model subagent calls for autonomous ratio calculation.
  if (model) {
    const intentMatch = line.match(/\| \[([a-zA-Z0-9/\-]+)\]$/) ?? line.match(/\[([a-zA-Z0-9/\-]+)\]\s*$/);
    if (intentMatch && isSubagentIntent(intentMatch[1])) {
      incrementCount(ctx.subagentByModel, model);
    }
  }

  const isNes = lower.includes("[xtabprovider]") || lower.includes("[nes.");
  if (isNes) {
    recordInlineAccepted(ctx, dateKey, hourKey, model, latency);
  } else {
    recordChatRequest(ctx, dateKey, hourKey, model, latency);
    const classification = classifyIntent(rawIntent);
    pushSessionSignal(ctx, {
      timestamp,
      signalType: rawIntent === "panel/unknown" ? "plan-proposal" : "chat-request",
      actor: classification.actor,
      phase: classification.phase,
      intent: rawIntent,
      rawText: line,
      modelName: model,
      latencyMs: latency,
      success: true,
    });
  }
  return true;
}

/**
 * Parse context provider log lines that record which context sources were used.
 * Detects lines containing the word "context" or known context-service keywords
 * (e.g. WorkspaceChunkSearchService, GithubAvailableEmbeddingTypesManager, reposearch)
 * even when the exact word "context" is absent.
 * Returns true if the line was handled as a context event.
 */
function parseContextProviderLine(line: string, lower: string, ctx: ParsingContext): boolean {
  // Accept lines that mention "context" or any known context source keyword.
  const hasContext = lower.includes("context");
  const hasServiceKeyword =
    lower.includes("workspacechunk") ||
    lower.includes("embedding") ||
    lower.includes("reposearch") ||
    lower.includes("opentab") ||
    lower.includes("workspace") ||
    lower.includes("mcp") ||
    lower.includes("externaldoc") ||
    lower.includes("currentfile") ||
    lower.includes("snippet");
  if (!hasContext && !hasServiceKeyword) {
    return false;
  }
  const sourcePatterns: [RegExp, string][] = [
    [/opentab/i, "Open Tabs"],
    [/workspace/i, "Workspace"],
    [/reposearch/i, "Workspace"],
    [/embedding/i, "Workspace"],
    [/\bmcp\b/i, "MCP / External Docs"],
    [/externaldoc/i, "MCP / External Docs"],
    [/(agent-plugin|plugin|skill)/i, "Plugin / Skill"],
    [/(browsertool|browser tool|playwright|screenshot)/i, "Browser Tool"],
    [/(session_memory|session memory|compact|compaction)/i, "Session Memory"],
    [/currentfile/i, "Current File"],
    [/snippet/i, "Snippet"],
  ];
  for (const [pattern, source] of sourcePatterns) {
    if (pattern.test(line)) {
      incrementCount(ctx.byContextSource, source);
      return true;
    }
  }
  // "context" is present but no known source pattern matched — count as unknown.
  if (hasContext) {
    incrementCount(ctx.byContextSource, "Unknown Context");
    return true;
  }
  return false;
}

/**
 * Detect "[ToolCallingLoop] Subagent stop hook result: shouldContinue=false" lines.
 * Closes the active subagent loop and accumulates the autonomous duration.
 * Returns true if the line was handled.
 */
function parseToolCallingLoopStopLine(line: string, ctx: ParsingContext): boolean {
  const lower = line.toLowerCase();
  if (!lower.includes("[toolcallingloop]") || !/shouldcontinue\s*=\s*false/.test(lower)) {
    return false;
  }
  ctx.subagentLoops++;
  pushSessionSignal(ctx, {
    timestamp: extractTimestampFromText(line),
    signalType: "tool-loop-stop",
    actor: "system",
    phase: "execution",
    intent: "tool-calling-loop-stop",
    rawText: line,
    modelName: ctx.activeSubagentLoopModel ?? "",
    latencyMs: 0,
    success: true,
  });
  if (ctx.activeSubagentLoop !== null) {
    const dateKey = ctx.activeSubagentLoop.slice(0, 10);
    const actionCount = ctx.activeSubagentLoopActionCount;
    const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (tsMatch) {
      const startMs = new Date(ctx.activeSubagentLoop.replace(/\s+/g, "T")).getTime();
      const endMs = new Date(tsMatch[1].replace(/\s+/g, "T")).getTime();
      if (endMs > startMs) {
        const durationMs = endMs - startMs;
        ctx.autonomousDurationMs += durationMs;
        const dateDuration = ctx.autonomousDurationByDate.get(dateKey) ?? 0;
        ctx.autonomousDurationByDate.set(dateKey, dateDuration + durationMs);
        if (ctx.activeSubagentLoopModel) {
          const prev = ctx.autonomousDurationByModel.get(ctx.activeSubagentLoopModel) ?? 0;
          ctx.autonomousDurationByModel.set(ctx.activeSubagentLoopModel, prev + durationMs);
        }
      }
    }

    incrementCount(ctx.loopsCompletedByDate, dateKey);
    const dateTotalActions = ctx.totalLoopActionsByDate.get(dateKey) ?? 0;
    ctx.totalLoopActionsByDate.set(dateKey, dateTotalActions + actionCount);
    const dateDist = ctx.loopDistributionByDate.get(dateKey) ?? {
      bucket1: 0,
      bucket2: 0,
      bucket3to5: 0,
      bucket6to10: 0,
      bucket11plus: 0,
    };
    if (actionCount === 1) {
      dateDist.bucket1++;
    } else if (actionCount === 2) {
      dateDist.bucket2++;
    } else if (actionCount <= 5) {
      dateDist.bucket3to5++;
    } else if (actionCount <= 10) {
      dateDist.bucket6to10++;
    } else {
      dateDist.bucket11plus++;
    }
    ctx.loopDistributionByDate.set(dateKey, dateDist);

    // Record per-model completion and action-count histogram.
    const model = ctx.activeSubagentLoopModel;
    if (model) {
      incrementCount(ctx.loopsCompletedByModel, model);
      const prev = ctx.totalLoopActionsByModel.get(model) ?? 0;
      ctx.totalLoopActionsByModel.set(model, prev + actionCount);
      const dist = ctx.loopDistributionByModel.get(model) ?? {
        bucket1: 0,
        bucket2: 0,
        bucket3to5: 0,
        bucket6to10: 0,
        bucket11plus: 0,
      };
      if (actionCount === 1) {
        dist.bucket1++;
      } else if (actionCount === 2) {
        dist.bucket2++;
      } else if (actionCount <= 5) {
        dist.bucket3to5++;
      } else if (actionCount <= 10) {
        dist.bucket6to10++;
      } else {
        dist.bucket11plus++;
      }
      ctx.loopDistributionByModel.set(model, dist);
    }

    ctx.activeSubagentLoop = null;
    ctx.activeSubagentLoopModel = null;
    ctx.activeSubagentLoopActionCount = 0;
  }
  return true;
}

function parseRunInTerminalCommandLine(line: string, timestamp: string, ctx: ParsingContext): boolean {
  if (!line.includes("RunInTerminalTool#CommandLineAutoApproveAnalyzer: Parsed sub-commands via bash grammar")) {
    return false;
  }

  const commandsMatch = line.match(/(\[\[.*\]\])$/);
  if (!commandsMatch) {
    return false;
  }

  try {
    const commandGroups = JSON.parse(commandsMatch[1]) as string[][];
    for (const group of commandGroups) {
      for (const command of group) {
        const trimmed = command.trim();
        if (trimmed) {
          recordCommandExecutionSignal(ctx, trimmed, timestamp);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function parseTextLogLine(line: string, ctx: ParsingContext): void {
  const lineCtx = extractLineContext(line);

  // Planning & Execution stats are checked first so that workspace/editFile
  // and apply_patch lines are not shadowed by the context provider parser
  // (which would consume any line containing the word "workspace").
  trackPlanningStats(lineCtx.lower, ctx, lineCtx.timestamp, line);

  maybeRecordFeatureSignals(line, ctx, lineCtx.timestamp);

  if (parseToolCallingLoopStopLine(line, ctx)) {
    return;
  }
  if (parseRunInTerminalCommandLine(line, lineCtx.timestamp, ctx)) {
    return;
  }
  if (parseFetchCompletionsLine(line, lineCtx, ctx)) {
    return;
  }
  if (parseAbortErrorLine(line, lineCtx.lower, ctx)) {
    return;
  }
  if (parseCcreqLine(line, lineCtx, ctx)) {
    return;
  }
  if (parseContextProviderLine(line, lineCtx.lower, ctx)) {
    return;
  }
}
