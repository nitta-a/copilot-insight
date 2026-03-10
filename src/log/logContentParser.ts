import type { SessionActor, SessionPhase, SessionSignalEvent } from "../events/eventSchema";
import type { LanguageStat, ParsingContext } from "../types";

/** Intent tag → human-readable display name for known chat intents. */
const INTENT_DISPLAY_NAMES: Record<string, string> = {
  "panel/editAgent": "Agent",
  "panel/unknown": "Plan",
  title: "Title",
  progressMessages: "Progress",
  vscodePrompt: "Ask",
  copilotLanguageModelWrapper: "Ask (Old)",
  intentDetection: "Intent Detection",
};

const KNOWN_CHAT_INTENTS = new Set(Object.keys(INTENT_DISPLAY_NAMES));

/** Intent tags that identify subagent-initiated requests. */
const SUBAGENT_INTENTS = new Set(["tool/runSubagent", "panel/editAgent", "tool/searchSubagentTool"]);

const FEATURE_VALUE_KEYS = [
  "event",
  "eventName",
  "intent",
  "toolName",
  "toolType",
  "pluginName",
  "skillName",
  "command",
  "action",
  "category",
  "sourceType",
  "contextType",
] as const;

const CHAT_TITLE_JSON_KEY_PATTERN = /"(title|topic|summary)"\s*:/i;
const THREAD_TITLE_KEYS = ["title", "topic", "summary"] as const;

/** Returns true if the intent is a known subagent intent or a tool/runSubagent-* variant. */
export function isSubagentIntent(intent: string): boolean {
  return SUBAGENT_INTENTS.has(intent) || intent.startsWith("tool/runSubagent-");
}

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
 *   4. Strip `-copilot` vendor suffix (case-insensitive)
 *      (e.g. "gpt-41-copilot" → "gpt-41")
 *   5. Trim surrounding whitespace.
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
  // Rule 4: strip trailing -copilot vendor suffix (e.g. "gpt-41-copilot" → "gpt-41")
  if (base.toLowerCase().endsWith("-copilot")) {
    base = base.slice(0, -"-copilot".length).trim();
  }
  // Rule 5: final whitespace trim (already applied above after each rule, kept for clarity)
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

/**
 * Normalize a raw context source type string to a canonical display name.
 * Returns the original `raw` string when no known pattern matches, so that
 * unknown-but-real sources remain visible instead of being silently dropped.
 * Returns "" only when `raw` is empty.
 */
export function normalizeContextSource(raw: string): string {
  if (!raw) {
    return "";
  }
  const lower = raw.toLowerCase().replace(/[-_ ]/g, "");
  if (lower.includes("opentab")) {
    return "Open Tabs";
  }
  if (lower.includes("workspace") || lower.includes("reposearch") || lower.includes("embedding")) {
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
  return raw;
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

function parseBrowserToolType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("playwright")) {
    return "playwright";
  }
  if (lower.includes("screenshot")) {
    return "screenshot";
  }
  if (
    lower.includes("browser-navigate") ||
    lower.includes("browser_navigate") ||
    lower.includes("browser tool: navigate")
  ) {
    return "navigate";
  }
  if (lower.includes("browser tool") || lower.includes("browsertool") || lower.includes("browser-")) {
    return "browser";
  }
  return "browser-tool";
}

function parsePluginOrSkillType(raw: string): string {
  const lower = raw.toLowerCase();
  const namedMatch = raw.match(/(?:agent-plugin|plugin|skill)(?:name)?[:= ]+([a-zA-Z0-9._/-]+)/i);
  if (namedMatch?.[1]) {
    return namedMatch[1];
  }
  if (lower.includes("agent-plugin")) {
    return "agent-plugin";
  }
  if (lower.includes("skill")) {
    return "skill";
  }
  if (lower.includes("[plugin") || /\bplugin[:= ]/.test(lower)) {
    return "plugin";
  }
  if (lower.includes("tool-call") || lower.includes("tool_call")) {
    return "tool-call";
  }
  if (lower.includes("toolinvocation") || lower.includes("tool invocation")) {
    return "tool-invocation";
  }
  if (lower.includes("invoketool") || lower.includes("invoke_tool")) {
    return "invoke-tool";
  }
  return "plugin-or-skill";
}

function parseMemoryManagementType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("/compact")) {
    return "compact";
  }
  if (lower.includes("context_limit_reached")) {
    return "context-limit-reached";
  }
  if (lower.includes("truncating_history") || lower.includes("truncating history")) {
    return "truncating-history";
  }
  if (lower.includes("context_limit") || lower.includes("context limit")) {
    return "context-limit";
  }
  if (lower.includes("summarize_context") || lower.includes("summarize context")) {
    return "summarize";
  }
  if (lower.includes("session_memory") || lower.includes("session memory")) {
    return "session-memory";
  }
  if (lower.includes("compaction")) {
    return "compaction";
  }
  return "memory";
}

function normalizeTimestamp(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?![A-Za-z+-])/, "$1T$2");
}

function extractTimestampFromText(raw: string): string {
  const match = raw.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  return match ? normalizeTimestamp(match[1]) : "";
}

function classifyIntent(rawIntent: string): { actor: SessionActor; phase: SessionPhase } {
  if (!rawIntent) {
    return { actor: "system", phase: "planning" };
  }
  if (rawIntent === "vscodePrompt" || rawIntent === "copilotLanguageModelWrapper") {
    return { actor: "human", phase: "human" };
  }
  if (rawIntent === "title" || rawIntent === "progressMessages") {
    return { actor: "system", phase: "planning" };
  }
  if (rawIntent === "panel/unknown" || rawIntent === "agent/plan" || rawIntent === "strategy/propose") {
    return { actor: "ai", phase: "planning" };
  }
  if (rawIntent === "tool/searchSubagentTool") {
    return { actor: "ai", phase: "research" };
  }
  if (rawIntent === "intentDetection") {
    return { actor: "system", phase: "planning" };
  }
  if (isSubagentIntent(rawIntent) || rawIntent === "workspace/editfile" || rawIntent === "apply_patch") {
    return { actor: "ai", phase: "execution" };
  }
  return { actor: "human", phase: "human" };
}

function pushSessionSignal(
  ctx: ParsingContext,
  signal: Omit<SessionSignalEvent, "eventType" | "sessionId" | "languageId">,
): void {
  if (!ctx.currentSessionId || !signal.timestamp) {
    return;
  }
  ctx.sessionSignals.push({
    eventType: "sessionSignal",
    sessionId: ctx.currentSessionId,
    languageId: "",
    ...signal,
  });
}

function parseAgentDebugType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("step-execution") || lower.includes("step execution")) {
    return "step-execution";
  }
  if (lower.includes("breakpoint")) {
    return "breakpoint";
  }
  if (lower.includes("agent-debug") || lower.includes("agent debug")) {
    return "agent-debug";
  }
  if (lower.includes("agent trace")) {
    return "trace";
  }
  return "debug";
}

function recordBrowserToolSignal(ctx: ParsingContext, raw: string, timestamp: string): void {
  const toolType = parseBrowserToolType(raw);
  ctx.browserToolInvocations++;
  incrementCount(ctx.browserToolsByType, toolType);
  pushSessionSignal(ctx, {
    timestamp,
    signalType: "chat-request",
    actor: "ai",
    phase: "research",
    intent: `browser/${toolType}`,
    rawText: raw,
    modelName: "",
    latencyMs: 0,
    success: true,
  });
}

function recordPluginOrSkillSignal(ctx: ParsingContext, raw: string): void {
  ctx.pluginOrSkillInvocations++;
  incrementCount(ctx.pluginOrSkillByName, parsePluginOrSkillType(raw));
}

function recordMemoryManagementSignal(ctx: ParsingContext, raw: string, timestamp: string): void {
  const type = parseMemoryManagementType(raw);
  incrementCount(ctx.memoryManagementByType, type);
  if (!timestamp) {
    return;
  }
  ctx.memoryManagementEvents.push({
    timestamp,
    type,
    rawText: raw,
    sessionId: ctx.currentSessionId,
  });
  pushSessionSignal(ctx, {
    timestamp,
    signalType: "memory-boundary",
    actor: "system",
    phase: "memory",
    intent: type,
    rawText: raw,
    modelName: "",
    latencyMs: 0,
    success: true,
  });
}

function recordReferenceSignal(ctx: ParsingContext, source: string, timestamp: string, rawText: string): void {
  pushSessionSignal(ctx, {
    timestamp,
    signalType: "reference-used",
    actor: "system",
    phase: "research",
    intent: `reference/${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    rawText,
    modelName: "",
    latencyMs: 0,
    success: true,
  });
}

function recordCommandExecutionSignal(ctx: ParsingContext, command: string, timestamp: string): void {
  pushSessionSignal(ctx, {
    timestamp,
    signalType: "command-executed",
    actor: "ai",
    phase: "execution",
    intent: "terminal/runCommand",
    rawText: command,
    modelName: "",
    latencyMs: 0,
    success: true,
  });
}

function recordAgentDebugSignal(ctx: ParsingContext, raw: string): void {
  ctx.agentDebugEvents++;
  incrementCount(ctx.agentDebugByType, parseAgentDebugType(raw));
}

function getJsonFeatureText(data: Record<string, unknown>): string {
  const values = FEATURE_VALUE_KEYS.map((key) => data[key]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return values.join(" ");
}

function sanitiseThreadTitleCandidate(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .slice(0, 80);
}

function looksLikeThreadTitleCandidate(value: string): boolean {
  if (value.length < 4) {
    return false;
  }
  if (/^[a-f0-9-]{20,}$/i.test(value)) {
    return false;
  }
  if (value.includes("://")) {
    return false;
  }
  return true;
}

export function extractThreadTitleFromPayload(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const title = extractThreadTitleFromPayload(entry);
      if (title) {
        return title;
      }
    }
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const key of THREAD_TITLE_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      const candidate = sanitiseThreadTitleCandidate(value);
      if (looksLikeThreadTitleCandidate(candidate)) {
        return candidate;
      }
    }
  }

  for (const value of Object.values(record)) {
    const nested = extractThreadTitleFromPayload(value);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function recordThreadTitleSignal(ctx: ParsingContext, raw: string, timestamp: string): void {
  pushSessionSignal(ctx, {
    timestamp,
    signalType: "thread-title",
    actor: "system",
    phase: "planning",
    intent: "thread-title",
    rawText: raw,
    modelName: "",
    latencyMs: 0,
    success: true,
  });
}

function maybeRecordFeatureSignals(raw: string, ctx: ParsingContext, timestamp = ""): boolean {
  const lower = raw.toLowerCase();
  let matched = false;

  const hasBrowserSignal =
    lower.includes("playwright") ||
    lower.includes("browser tool") ||
    lower.includes("browsertool") ||
    lower.includes("browser-") ||
    lower.includes("browser_") ||
    lower.includes("screenshot");
  if (hasBrowserSignal) {
    recordBrowserToolSignal(ctx, raw, timestamp);
    matched = true;
  }

  const hasPluginOrSkillSignal =
    lower.includes("agent-plugin") ||
    lower.includes("[plugin") ||
    lower.includes("[skill") ||
    /\bplugin[:= ]/.test(lower) ||
    /\bskill[:= ]/.test(lower) ||
    lower.includes("tool-call") ||
    lower.includes("tool_call") ||
    lower.includes("tool invocation") ||
    lower.includes("toolinvocation") ||
    lower.includes("invoketool") ||
    lower.includes("invoke_tool");
  if (hasPluginOrSkillSignal) {
    recordPluginOrSkillSignal(ctx, raw);
    matched = true;
  }

  const hasMemorySignal =
    lower.includes("/compact") ||
    lower.includes("session memory") ||
    lower.includes("session_memory") ||
    lower.includes("context_limit_reached") ||
    lower.includes("truncating_history") ||
    lower.includes("truncating history") ||
    lower.includes("context_limit") ||
    lower.includes("context limit") ||
    lower.includes("summarize_context") ||
    lower.includes("summarize context") ||
    lower.includes("compaction");
  if (hasMemorySignal) {
    recordMemoryManagementSignal(ctx, raw, timestamp);
    matched = true;
  }

  const hasAgentDebugSignal =
    lower.includes("agent-debug") ||
    lower.includes("agent debug") ||
    lower.includes("step-execution") ||
    lower.includes("step execution") ||
    lower.includes("breakpoint") ||
    lower.includes("agent trace");
  if (hasAgentDebugSignal) {
    recordAgentDebugSignal(ctx, raw);
    matched = true;
  }

  return matched;
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
  timestamp: string;
}

function extractLineContext(line: string): LineContext {
  const lower = line.toLowerCase();
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  const dateKey = dateMatch ? dateMatch[1] : "";
  const hourMatch = line.match(/\d{4}-\d{2}-\d{2} (\d{2}):/);
  const hourKey = hourMatch ? hourMatch[1] : "";
  const timestamp = extractTimestampFromText(line);
  return { lower, dateKey, hourKey, timestamp };
}

export function processJsonEntry(data: Record<string, unknown>, ctx: ParsingContext, fallbackTimestamp = ""): void {
  const event = (data.event as string | undefined) ?? (data.eventName as string | undefined) ?? "";
  const timestamp = normalizeTimestamp((data.timestamp as string | undefined) ?? fallbackTimestamp);
  const dateKey = timestamp ? timestamp.substring(0, 10) : "";
  const featureText = getJsonFeatureText(data);

  const eventLower = event.toLowerCase();
  const isShown = eventLower.includes("shown") || eventLower.includes("displayed") || eventLower.includes("triggered");
  const isAccepted = !isShown && eventLower.includes("accepted");

  if (isShown) {
    ctx.totalShown++;
    incrementStatCount(ctx.byDate, dateKey, "shown");
  } else if (isAccepted) {
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
      if (isShown) {
        incrementStatCount(ctx.byModel, model, "shown");
      } else if (isAccepted) {
        incrementStatCount(ctx.byModel, model, "accepted");
      } else if (!eventLower.includes("rejected") && !eventLower.includes("dismissed")) {
        incrementCount(ctx.byChatModel, model);
      }
    }
  }

  // Context Window Insights: parse context source references from JSON telemetry
  const effectivenessType: "shown" | "accepted" | null = isShown ? "shown" : isAccepted ? "accepted" : null;
  const contextItems = data.contextItems ?? data.references ?? data.usedContext;
  if (Array.isArray(contextItems)) {
    for (const item of contextItems) {
      const rawType = (item as Record<string, unknown>)?.type ?? (item as Record<string, unknown>)?.kind;
      if (typeof rawType === "string") {
        const source = normalizeContextSource(rawType);
        if (source) {
          incrementCount(ctx.byContextSource, source);
          if (effectivenessType) {
            incrementStatCount(ctx.byContextEffectiveness, source, effectivenessType);
          }
          if (timestamp) {
            recordReferenceSignal(ctx, source, timestamp, source);
          }
        }
      }
    }
  }
  const directType = data.contextType ?? data.sourceType;
  if (typeof directType === "string") {
    const source = normalizeContextSource(directType);
    if (source) {
      incrementCount(ctx.byContextSource, source);
      if (effectivenessType) {
        incrementStatCount(ctx.byContextEffectiveness, source, effectivenessType);
      }
      if (timestamp) {
        recordReferenceSignal(ctx, source, timestamp, source);
      }
    }
  }

  if (featureText) {
    maybeRecordFeatureSignals(featureText, ctx, timestamp);
  }

  // Planning & Execution: check event name for plan/execution signals.
  trackPlanningStats(eventLower, ctx, timestamp, event);
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
    const timestamp = extractTimestampFromText(line);
    if (CHAT_TITLE_JSON_KEY_PATTERN.test(jsonMatch[0])) {
      const threadTitle = extractThreadTitleFromPayload(data);
      if (threadTitle && ctx.currentSessionId && timestamp) {
        recordThreadTitleSignal(ctx, threadTitle, timestamp);
      }
    }
    processJsonEntry(data, ctx, timestamp);
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

// --- Planning & Execution tracking ---

/**
 * Detect plan-proposal events: JSON events with `agent/plan` or `strategy/propose`
 * signatures, and plain-text log lines containing the same keywords.
 * Returns true if the line was identified as a plan-proposal.
 */
function isPlanProposalLine(lower: string): boolean {
  return lower.includes("agent/plan") || lower.includes("strategy/propose");
}

/**
 * Detect plan-execution events: JSON events with `workspace/editfile` or `apply_patch`
 * signatures, and plain-text log lines containing the same keywords.
 * Returns true if the line was identified as a plan-execution action.
 */
function isPlanExecutionLine(lower: string): boolean {
  return lower.includes("workspace/editfile") || lower.includes("apply_patch");
}

/**
 * Detect in-plan user choice interactions (`choice_selected`).
 */
function isChoiceSelectedLine(lower: string): boolean {
  return lower.includes("choice_selected");
}

/**
 * Update plan tracking state for a single log line (plain-text or JSON-derived).
 */
function trackPlanningStats(lower: string, ctx: ParsingContext, timestamp = "", rawText = ""): void {
  if (isPlanProposalLine(lower)) {
    ctx.planCount++;
    ctx.activePlanPending = true;
    pushSessionSignal(ctx, {
      timestamp,
      signalType: "plan-proposal",
      actor: "ai",
      phase: "planning",
      intent: lower.includes("strategy/propose") ? "strategy/propose" : "agent/plan",
      rawText,
      modelName: "",
      latencyMs: 0,
      success: true,
    });
  }
  if (isPlanExecutionLine(lower)) {
    if (ctx.activePlanPending) {
      ctx.executedPlanCount++;
      ctx.activePlanPending = false;
    }
    pushSessionSignal(ctx, {
      timestamp,
      signalType: "chat-request",
      actor: "ai",
      phase: "execution",
      intent: lower.includes("apply_patch") ? "apply_patch" : "workspace/editfile",
      rawText,
      modelName: "",
      latencyMs: 0,
      success: true,
    });
  }
  if (isChoiceSelectedLine(lower)) {
    ctx.userChoicesInPlan++;
    pushSessionSignal(ctx, {
      timestamp,
      signalType: "user-choice",
      actor: "human",
      phase: "human",
      intent: "choice_selected",
      rawText,
      modelName: "",
      latencyMs: 0,
      success: true,
    });
  }
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
