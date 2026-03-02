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
  const language = (data.language as string | undefined) ?? (data.languageId as string | undefined) ?? "";
  const timestamp = (data.timestamp as string | undefined) ?? "";
  const dateKey = timestamp ? timestamp.substring(0, 10) : "";

  const eventLower = event.toLowerCase();
  if (eventLower.includes("shown") || eventLower.includes("displayed") || eventLower.includes("triggered")) {
    ctx.totalShown++;
    incrementStatCount(ctx.byLanguage, language, "shown");
    incrementStatCount(ctx.byDate, dateKey, "shown");
  } else if (eventLower.includes("accepted")) {
    ctx.totalAccepted++;
    incrementStatCount(ctx.byLanguage, language, "accepted");
    incrementStatCount(ctx.byDate, dateKey, "accepted");
  } else if (eventLower.includes("rejected") || eventLower.includes("dismissed")) {
    ctx.totalRejected++;
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
 * Extract a language identifier from a log line.
 *
 * Handles both the modern `languageId: "typescript"` (with optional quotes)
 * and the legacy `language: typescript` / `lang: typescript` formats.
 */
export function extractLanguageFromLine(line: string): string {
  const match =
    line.match(/languageId:\s*"([^"]+)"/i) ??
    line.match(/languageId:\s*'([^']+)'/i) ??
    line.match(/languageId:\s*([a-zA-Z][a-zA-Z0-9_-]*)/i) ??
    line.match(/language:\s*"([^"]+)"/i) ??
    line.match(/language[:\s]+([a-zA-Z][a-zA-Z0-9_-]*)/i) ??
    line.match(/lang:\s*([a-zA-Z][a-zA-Z0-9_-]*)/i);
  return match ? match[1].toLowerCase() : "";
}

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
  const language = extractLanguageFromLine(line);

  if (statusCode === 200) {
    ctx.totalShown++;
    if (dateKey) {
      incrementStatCount(ctx.byDate, dateKey, "shown");
    }
    if (hourKey) {
      incrementCount(ctx.byHour, hourKey);
    }
    if (language) {
      incrementStatCount(ctx.byLanguage, language, "shown");
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
  const model = ccreqMatch ? ccreqMatch[1].trim() : "";
  const latency = ccreqMatch ? Number.parseInt(ccreqMatch[2], 10) : 0;

  trackChatIntent(line, ctx);

  const isNes = lower.includes("[xtabprovider]") || lower.includes("[nes.");
  if (isNes) {
    recordInlineAccepted(ctx, dateKey, hourKey, model, latency);
  } else {
    recordChatRequest(ctx, dateKey, hourKey, model, latency);
  }
  return true;
}

/** Extract and record the chat intent tag from a ccreq success line. */
function trackChatIntent(line: string, ctx: ParsingContext): void {
  const intentMatch = line.match(/\| \[([a-zA-Z0-9/]+)\]$/) ?? line.match(/\[([a-zA-Z0-9/]+)\]\s*$/);
  if (!intentMatch) {
    return;
  }
  const rawIntent = intentMatch[1];
  if (KNOWN_CHAT_INTENTS.has(rawIntent)) {
    const displayName = INTENT_DISPLAY_NAMES[rawIntent] ?? rawIntent;
    incrementCount(ctx.byChatIntent, displayName);
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
  const language = extractLanguageFromLine(line);

  if (lower.includes("suggestion shown") || lower.includes("completion shown") || lower.includes("shown suggestion")) {
    ctx.totalShown++;
    if (language) {
      incrementStatCount(ctx.byLanguage, language, "shown");
    }
    if (dateKey) {
      incrementStatCount(ctx.byDate, dateKey, "shown");
    }
  } else if (
    lower.includes("suggestion accepted") ||
    lower.includes("completion accepted") ||
    lower.includes("accepted suggestion")
  ) {
    ctx.totalAccepted++;
    if (language) {
      incrementStatCount(ctx.byLanguage, language, "accepted");
    }
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

export function parseTextLogLine(line: string, ctx: ParsingContext): void {
  const lineCtx = extractLineContext(line);

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
