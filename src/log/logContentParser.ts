import type { LanguageStat, ParsingContext } from "../types";

/** Intent tag → human-readable display name for known chat intents. */
const INTENT_DISPLAY_NAMES: Record<string, string> = {
  "panel/editAgent": "Agent",
  "panel/unknown": "Plan",
  vscodePrompt: "Ask",
  copilotLanguageModelWrapper: "Ask (Old)",
  intentDetection: "Intent Detection",
};

const KNOWN_CHAT_INTENTS = new Set(Object.keys(INTENT_DISPLAY_NAMES));

/** Intent tags that identify subagent-initiated requests. */
const SUBAGENT_INTENTS = new Set(["tool/runSubagent", "panel/editAgent", "tool/searchSubagentTool"]);

/**
 * Normalize a raw model name by stripping deployment paths and internal IDs.
 *
 * Rules applied in order:
 *   1. Strip deployment alias: remove everything from ` -> ` onward
 *      (e.g. "gpt-4o -> gpt-4o-2024-11-20" → "gpt-4o")
 *   2. Strip colon suffix: remove everything from the first `:` onward
 *      (e.g. "gpt-5-mini:20241101" → "gpt-5-mini")
 *   3. Strip hash suffix: remove everything from the first `#` onward
 *      (e.g. "claude-3.5-sonnet#abc123" → "claude-3.5-sonnet")
 *   4. Trim surrounding whitespace.
 */
export function normalizeModelName(model: string): string {
  // Rule 1: strip deployment path after ' -> '
  const arrowIdx = model.indexOf(" -> ");
  let base = (arrowIdx !== -1 ? model.substring(0, arrowIdx) : model).trim();
  // Rule 2: strip colon version/date/ID suffix
  const colonIdx = base.indexOf(":");
  if (colonIdx > 0) {
    base = base.substring(0, colonIdx).trim();
  }
  // Rule 3: strip hash suffix
  const hashIdx = base.indexOf("#");
  if (hashIdx > 0) {
    base = base.substring(0, hashIdx).trim();
  }
  return base;
}

/**
 * Merge a `Map<string, LanguageStat>` using normalized model name keys.
 * Entries whose raw keys normalize to the same string are summed together.
 * Entries that normalize to an empty string (e.g. raw key was only special
 * characters or deployment suffixes with no base name) are silently skipped.
 */
export function mergeStatsByNormalizedModel(source: Map<string, LanguageStat>): Map<string, LanguageStat> {
  const merged = new Map<string, LanguageStat>();
  for (const [rawKey, stat] of source) {
    const key = normalizeModelName(rawKey);
    if (!key) {
      // Skip entries that have no usable base name after normalization.
      continue;
    }
    const existing = merged.get(key) ?? { shown: 0, accepted: 0 };
    merged.set(key, { shown: existing.shown + stat.shown, accepted: existing.accepted + stat.accepted });
  }
  return merged;
}

/**
 * Merge a `Map<string, number>` count map using normalized model name keys.
 * Entries whose raw keys normalize to the same string are summed together.
 * Entries that normalize to an empty string (e.g. raw key was only special
 * characters or deployment suffixes with no base name) are silently skipped.
 */
export function mergeCountByNormalizedModel(source: Map<string, number>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const [rawKey, count] of source) {
    const key = normalizeModelName(rawKey);
    if (!key) {
      // Skip entries that have no usable base name after normalization.
      continue;
    }
    merged.set(key, (merged.get(key) ?? 0) + count);
  }
  return merged;
}

/** Normalize a raw context source type string to a canonical display name. Returns "" if unknown. */
export function normalizeContextSource(raw: string): string {
  const lower = raw.toLowerCase().replace(/[-_ ]/g, "");
  if (lower.includes("opentab")) {
    return "Open Tabs";
  }
  if (lower.includes("workspace") || lower.includes("reposearch")) {
    return "Workspace";
  }
  if (lower.includes("mcp") || lower.includes("externaldoc")) {
    return "MCP / External Docs";
  }
  if (lower.includes("currentfile") || lower === "current") {
    return "Current File";
  }
  if (lower.includes("snippet")) {
    return "Snippet";
  }
  return "";
}

/** Increment a Map<string, number> counter by 1 (no-op if key is empty). */
export function incrementCount(map: Map<string, number>, key: string): void {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Increment a shown/accepted counter in a LanguageStat map. */
export function incrementStatCount(map: Map<string, LanguageStat>, key: string, type: "shown" | "accepted"): void {
  if (!key) {
    return;
  }
  const existing = map.get(key) ?? { shown: 0, accepted: 0 };
  existing[type]++;
  map.set(key, existing);
}

// --- Session tracking ---

function getOrCreateSession(ctx: ParsingContext) {
  const sessionId = ctx.currentSessionId;
  if (!sessionId) {
    return undefined;
  }
  const session = ctx.bySession.get(sessionId) ?? {
    sessionId,
    shown: 0,
    accepted: 0,
    chat: 0,
    errors: 0,
  };
  ctx.bySession.set(sessionId, session);
  return session;
}

function trackSessionActivity(ctx: ParsingContext, activity: "shown" | "accepted" | "chat"): void {
  const session = getOrCreateSession(ctx);
  if (session) {
    session[activity]++;
  }
}

function trackSessionError(ctx: ParsingContext): void {
  const session = getOrCreateSession(ctx);
  if (session) {
    session.errors++;
  }
}

// --- Line context extraction ---

interface LineContext {
  lower: string;
  dateKey: string;
  hourKey: string;
}

function extractLineContext(line: string): LineContext {
  const lower = line.toLowerCase();
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  const dateKey = dateMatch ? dateMatch[1] : "";
  const hourMatch = line.match(/\d{4}-\d{2}-\d{2} (\d{2}):/);
  const hourKey = hourMatch ? hourMatch[1] : "";
  return { lower, dateKey, hourKey };
}

export function processJsonEntry(data: Record<string, unknown>, ctx: ParsingContext): void {
  const event = (data.event as string | undefined) ?? (data.eventName as string | undefined) ?? "";
  const timestamp = (data.timestamp as string | undefined) ?? "";
  const dateKey = timestamp ? timestamp.substring(0, 10) : "";

  const eventLower = event.toLowerCase();
  if (eventLower.includes("shown") || eventLower.includes("displayed") || eventLower.includes("triggered")) {
    ctx.totalShown++;
    incrementStatCount(ctx.byDate, dateKey, "shown");
  } else if (eventLower.includes("accepted")) {
    ctx.totalAccepted++;
    incrementStatCount(ctx.byDate, dateKey, "accepted");
  } else if (eventLower.includes("rejected") || eventLower.includes("dismissed")) {
    ctx.totalRejected++;
  }

  // Extract and record normalized model name from JSON telemetry.
  const rawModel = data.model ?? data.modelId ?? data.engineId ?? data.engineName ?? data.engine;
  if (typeof rawModel === "string") {
    const model = normalizeModelName(rawModel);
    if (model) {
      if (eventLower.includes("shown") || eventLower.includes("displayed") || eventLower.includes("triggered")) {
        incrementStatCount(ctx.byModel, model, "shown");
      } else if (eventLower.includes("accepted")) {
        incrementStatCount(ctx.byModel, model, "accepted");
      } else if (!eventLower.includes("rejected") && !eventLower.includes("dismissed")) {
        incrementCount(ctx.byChatModel, model);
      }
    }
  }

  // Context Window Insights: parse context source references from JSON telemetry
  const contextItems = data.contextItems ?? data.references ?? data.usedContext;
  if (Array.isArray(contextItems)) {
    for (const item of contextItems) {
      const rawType = (item as Record<string, unknown>)?.type ?? (item as Record<string, unknown>)?.kind;
      if (typeof rawType === "string") {
        const source = normalizeContextSource(rawType);
        if (source) {
          incrementCount(ctx.byContextSource, source);
        }
      }
    }
  }
  const directType = data.contextType ?? data.sourceType;
  if (typeof directType === "string") {
    const source = normalizeContextSource(directType);
    if (source) {
      incrementCount(ctx.byContextSource, source);
    }
  }
}

export function tryParseJsonLogLine(line: string, ctx: ParsingContext): boolean {
  if (!line.includes("{") || !line.includes("}")) {
    return false;
  }
  try {
    const jsonMatch = line.match(/\{.*\}/);
    if (!jsonMatch) {
      return false;
    }
    const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    processJsonEntry(data, ctx);
    return true;
  } catch {
    return false;
  }
}

// --- Sub-parsers for parseTextLogLine ---

/**
 * Parse "[fetchCompletions] ... finished with NNN status after NNNms" lines.
 * Returns true if the line was handled.
 */
function parseFetchCompletionsLine(
  line: string,
  { lower, dateKey, hourKey }: LineContext,
  ctx: ParsingContext,
): boolean {
  if (!lower.includes("[fetchcompletions]") || !lower.includes("finished with")) {
    return false;
  }

  const statusMatch = line.match(/finished with (\d+) status/);
  const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;
  const latencyMatch = line.match(/after ([\d.]+)ms/);
  const latencyMs = latencyMatch ? Number.parseFloat(latencyMatch[1]) : 0;

  if (statusCode === 200) {
    ctx.totalShown++;
    if (dateKey) {
      incrementStatCount(ctx.byDate, dateKey, "shown");
    }
    if (hourKey) {
      incrementCount(ctx.byHour, hourKey);
    }
    const engineMatch = line.match(/\/v1\/engines\/([\w.-]+)\/completions/);
    if (engineMatch) {
      incrementStatCount(ctx.byModel, engineMatch[1], "shown");
    }
    if (latencyMs > 0) {
      ctx.latencySum += latencyMs;
      ctx.latencyCount++;
      ctx.latencies.push(latencyMs);
    }
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

/**
 * Parse "ccreq:<hash> | success/error/timeout | ..." lines.
 * Returns true if the line was handled.
 */
function parseCcreqLine(line: string, { lower, dateKey, hourKey }: LineContext, ctx: ParsingContext): boolean {
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

  trackChatIntent(line, ctx, model);

  // Track per-model subagent calls for autonomous ratio calculation.
  if (model) {
    const intentMatch = line.match(/\| \[([a-zA-Z0-9/]+)\]$/) ?? line.match(/\[([a-zA-Z0-9/]+)\]\s*$/);
    if (intentMatch && SUBAGENT_INTENTS.has(intentMatch[1])) {
      incrementCount(ctx.subagentByModel, model);
    }
  }

  const isNes = lower.includes("[xtabprovider]") || lower.includes("[nes.");
  if (isNes) {
    recordInlineAccepted(ctx, dateKey, hourKey, model, latency);
  } else {
    recordChatRequest(ctx, dateKey, hourKey, model, latency);
  }
  return true;
}

/** Extract and record the chat intent tag from a ccreq success line. */
function trackChatIntent(line: string, ctx: ParsingContext, model: string): void {
  const intentMatch = line.match(/\| \[([a-zA-Z0-9/]+)\]$/) ?? line.match(/\[([a-zA-Z0-9/]+)\]\s*$/);
  if (!intentMatch) {
    return;
  }
  const rawIntent = intentMatch[1];
  if (KNOWN_CHAT_INTENTS.has(rawIntent)) {
    const displayName = INTENT_DISPLAY_NAMES[rawIntent] ?? rawIntent;
    incrementCount(ctx.byChatIntent, displayName);
  }
  if (SUBAGENT_INTENTS.has(rawIntent)) {
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
 * Parse legacy/generic keyword lines for older log formats.
 */
function parseLegacyKeywordLine(line: string, lower: string, dateKey: string, ctx: ParsingContext): void {
  if (lower.includes("suggestion shown") || lower.includes("completion shown") || lower.includes("shown suggestion")) {
    ctx.totalShown++;
    if (dateKey) {
      incrementStatCount(ctx.byDate, dateKey, "shown");
    }
  } else if (
    lower.includes("suggestion accepted") ||
    lower.includes("completion accepted") ||
    lower.includes("accepted suggestion")
  ) {
    ctx.totalAccepted++;
    if (dateKey) {
      incrementStatCount(ctx.byDate, dateKey, "accepted");
    }
  } else if (lower.includes("suggestion rejected") || lower.includes("dismissed")) {
    ctx.totalRejected++;
  }
}

// --- Public API ---

/**
 * Parse context provider log lines that record which context sources were used.
 * Returns true if the line was handled as a context event.
 */
function parseContextProviderLine(line: string, lower: string, ctx: ParsingContext): boolean {
  if (!lower.includes("context")) {
    return false;
  }
  // Match lines like: "[ContextProvider] added openTab: file.ts"
  // or "context source: workspace" / "context from mcp"
  if (!lower.includes("[contextprovider]") && !lower.includes("context source") && !lower.includes("context from")) {
    return false;
  }
  const sourcePatterns: [RegExp, string][] = [
    [/opentab/i, "Open Tabs"],
    [/workspace/i, "Workspace"],
    [/\bmcp\b/i, "MCP / External Docs"],
    [/externaldoc/i, "MCP / External Docs"],
    [/currentfile/i, "Current File"],
    [/snippet/i, "Snippet"],
  ];
  for (const [pattern, source] of sourcePatterns) {
    if (pattern.test(line)) {
      incrementCount(ctx.byContextSource, source);
      return true;
    }
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
  if (!lower.includes("[toolcallingloop]") || !lower.includes("shouldcontinue=false")) {
    return false;
  }
  ctx.subagentLoops++;
  if (ctx.activeSubagentLoop !== null) {
    const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (tsMatch) {
      const startMs = new Date(ctx.activeSubagentLoop.replace(/\s+/g, "T")).getTime();
      const endMs = new Date(tsMatch[1].replace(/\s+/g, "T")).getTime();
      if (endMs > startMs) {
        const durationMs = endMs - startMs;
        ctx.autonomousDurationMs += durationMs;
        if (ctx.activeSubagentLoopModel) {
          const prev = ctx.autonomousDurationByModel.get(ctx.activeSubagentLoopModel) ?? 0;
          ctx.autonomousDurationByModel.set(ctx.activeSubagentLoopModel, prev + durationMs);
        }
      }
    }

    // Record per-model completion and action-count histogram.
    const model = ctx.activeSubagentLoopModel;
    if (model) {
      incrementCount(ctx.loopsCompletedByModel, model);
      const actionCount = ctx.activeSubagentLoopActionCount;
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

export function parseTextLogLine(line: string, ctx: ParsingContext): void {
  const lineCtx = extractLineContext(line);

  if (parseToolCallingLoopStopLine(line, ctx)) {
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
  parseLegacyKeywordLine(line, lineCtx.lower, lineCtx.dateKey, ctx);
}

export function parseLogContent(content: string, ctx: ParsingContext): void {
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    if (!tryParseJsonLogLine(line, ctx)) {
      parseTextLogLine(line, ctx);
    }
  }
}
