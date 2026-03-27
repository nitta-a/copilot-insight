/**
 * Shared parser utilities — constants, normalization helpers, session-signal
 * recording, and planning/execution tracking logic used by both the JSON-log
 * parser and the plain-text/ccreq parser.
 */

import type { SessionActor, SessionPhase, SessionSignalEvent } from "../../events/eventSchema";
import type { ParsingContext, UsageStatCount } from "../../types";

/** Intent tag → human-readable display name for known chat intents. */
export const INTENT_DISPLAY_NAMES: Record<string, string> = {
  "panel/editAgent": "Agent",
  "panel/unknown": "Plan",
  title: "Title",
  progressMessages: "Progress",
  vscodePrompt: "Ask",
  copilotLanguageModelWrapper: "Ask (Old)",
  intentDetection: "Intent Detection",
};

export const KNOWN_CHAT_INTENTS = new Set(Object.keys(INTENT_DISPLAY_NAMES));

/** Intent tags that identify subagent-initiated requests. */
export const SUBAGENT_INTENTS = new Set(["tool/runSubagent", "panel/editAgent", "tool/searchSubagentTool"]);

/**
 * Known Copilot Chat slash commands with their display labels.
 * These may appear in the `command` field of JSON log entries.
 */
export const SLASH_COMMAND_DISPLAY_NAMES: Record<string, string> = {
  "/fix": "/fix",
  "/explain": "/explain",
  "/tests": "/tests",
  "/test": "/test",
  "/doc": "/doc",
  "/new": "/new",
  "/newNotebook": "/newNotebook",
  "/clear": "/clear",
  "/help": "/help",
  "/search": "/search",
  "/simplify": "/simplify",
};

/** Known @participant identifiers used in Copilot Chat. */
export const PARTICIPANT_DISPLAY_NAMES: Record<string, string> = {
  "@workspace": "@workspace",
  "@terminal": "@terminal",
  "@vscode": "@vscode",
  "@github": "@github",
};

export const KNOWN_SLASH_COMMANDS = new Set(Object.keys(SLASH_COMMAND_DISPLAY_NAMES));
export const KNOWN_PARTICIPANTS = new Set(Object.keys(PARTICIPANT_DISPLAY_NAMES));

/**
 * Attempt to detect a slash command or @participant reference in a raw string.
 * Returns the canonical display name (e.g. "/fix", "@workspace") or "" if none detected.
 */
export function detectCommandUsage(raw: string): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim();
  // Exact match first (e.g. command field is exactly "/fix")
  if (KNOWN_SLASH_COMMANDS.has(trimmed)) {
    return SLASH_COMMAND_DISPLAY_NAMES[trimmed] ?? trimmed;
  }
  if (KNOWN_PARTICIPANTS.has(trimmed)) {
    return PARTICIPANT_DISPLAY_NAMES[trimmed] ?? trimmed;
  }
  const lower = trimmed.toLowerCase();
  // Prefix match for slash commands (e.g. "/fix: …" or "/explain code")
  for (const cmd of KNOWN_SLASH_COMMANDS) {
    if (lower === cmd || lower.startsWith(`${cmd} `) || lower.startsWith(`${cmd}:`)) {
      return SLASH_COMMAND_DISPLAY_NAMES[cmd] ?? cmd;
    }
  }
  // Prefix match for participants
  for (const participant of KNOWN_PARTICIPANTS) {
    if (lower === participant || lower.startsWith(`${participant} `) || lower.startsWith(`${participant}:`)) {
      return PARTICIPANT_DISPLAY_NAMES[participant] ?? participant;
    }
  }
  return "";
}

export const FEATURE_VALUE_KEYS = [
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

export const CHAT_TITLE_JSON_KEY_PATTERN = /"(title|topic|summary)"\s*:/i;
export const THREAD_TITLE_KEYS = ["title", "topic", "summary"] as const;

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
 * Merge a `Map<string, UsageStatCount>` using normalized model name keys.
 * Entries whose raw keys normalize to the same string are summed together.
 * Entries that normalize to an empty string (e.g. raw key was only special
 * characters or deployment suffixes with no base name) are silently skipped.
 */
export function mergeStatsByNormalizedModel(source: Map<string, UsageStatCount>): Map<string, UsageStatCount> {
  const merged = new Map<string, UsageStatCount>();
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

/** Increment a shown/accepted counter in a UsageStatCount map. */
export function incrementStatCount(map: Map<string, UsageStatCount>, key: string, type: "shown" | "accepted"): void {
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

export function normalizeTimestamp(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?![A-Za-z+-])/, "$1T$2");
}

export function extractTimestampFromText(raw: string): string {
  const match = raw.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  return match ? normalizeTimestamp(match[1]) : "";
}

export function classifyIntent(rawIntent: string): { actor: SessionActor; phase: SessionPhase } {
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

export function pushSessionSignal(
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

export function recordBrowserToolSignal(ctx: ParsingContext, raw: string, timestamp: string): void {
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

export function recordPluginOrSkillSignal(ctx: ParsingContext, raw: string): void {
  ctx.pluginOrSkillInvocations++;
  incrementCount(ctx.pluginOrSkillByName, parsePluginOrSkillType(raw));
}

export function recordMemoryManagementSignal(ctx: ParsingContext, raw: string, timestamp: string): void {
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

export function recordReferenceSignal(ctx: ParsingContext, source: string, timestamp: string, rawText: string): void {
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

export function recordCommandExecutionSignal(ctx: ParsingContext, command: string, timestamp: string): void {
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

export function recordAgentDebugSignal(ctx: ParsingContext, raw: string): void {
  ctx.agentDebugEvents++;
  incrementCount(ctx.agentDebugByType, parseAgentDebugType(raw));
}

export function getJsonFeatureText(data: Record<string, unknown>): string {
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

export function recordThreadTitleSignal(ctx: ParsingContext, raw: string, timestamp: string): void {
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

export function maybeRecordFeatureSignals(raw: string, ctx: ParsingContext, timestamp = ""): boolean {
  const lower = raw.toLowerCase();
  let matched = false;

  const hasBrowserSignal =
    lower.includes("playwright") ||
    lower.includes("browser tool") ||
    lower.includes("browsertool") ||
    lower.includes("browser-") ||
    lower.includes("browser_") ||
    lower.includes("browser") ||
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

export function getOrCreateSession(ctx: ParsingContext) {
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

export function trackSessionActivity(ctx: ParsingContext, activity: "shown" | "accepted" | "chat"): void {
  const session = getOrCreateSession(ctx);
  if (session) {
    session[activity]++;
  }
}

export function trackSessionError(ctx: ParsingContext): void {
  const session = getOrCreateSession(ctx);
  if (session) {
    session.errors++;
  }
}

// --- Line context extraction ---

export interface LineContext {
  lower: string;
  dateKey: string;
  hourKey: string;
  timestamp: string;
}

export function extractLineContext(line: string): LineContext {
  const lower = line.toLowerCase();
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  const dateKey = dateMatch ? dateMatch[1] : "";
  const hourMatch = line.match(/\d{4}-\d{2}-\d{2} (\d{2}):/);
  const hourKey = hourMatch ? hourMatch[1] : "";
  const timestamp = extractTimestampFromText(line);
  return { lower, dateKey, hourKey, timestamp };
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
export function trackPlanningStats(
  lower: string,
  ctx: ParsingContext,
  timestamp = "",
  rawText = "",
  modelName = "",
): void {
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
      modelName,
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
      modelName,
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
      modelName,
      latencyMs: 0,
      success: true,
    });
  }
}
