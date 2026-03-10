/**
 * DB Worker — analytics database running off the main thread.
 *
 * Equivalent to a DuckDB-Wasm Web Worker.  The `@duckdb/duckdb-wasm` package
 * is not used because of an open security advisory on all published versions;
 * {@link InMemoryAnalyticsDb} provides an equivalent in-process store.
 *
 * The worker reads JSONL event files written by {@link EventStorage} (the
 * "write side") and answers analytics queries — similar to how DuckDB would
 * use `read_json_auto` to read the same files.
 *
 * RPC protocol (structured-clone messages):
 *
 * | `type`           | `payload`                      | `result`                         |
 * |------------------|--------------------------------|----------------------------------|
 * | `loadFromJsonl`  | `{ storagePath: string }`      | `{ loaded: number }`             |
 * | `ingest`         | `TrackedEvent[]`               | `{ ingested: number, total: number }` |
 * | `query`          | SQL name string                | row array                        |
 * | `trueRate`       | `{ totalShown?, windowMs? }`   | {@link TrueAcceptanceResult}     |
 * | `velocity`       | `{ windowMs? }`                | {@link VelocityAnalysisResult}   |
 * | `modelPerf`      | —                              | serialisable model-perf result   |
 * | `close`          | —                              | `true`                           |
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parentPort } from "node:worker_threads";
import { InMemoryAnalyticsDb } from "../db/duckdbClient";
import type { SessionSignalEvent, TrackedEvent } from "../events/eventSchema";
import { isSubagentIntent } from "../log/logContentParser";
import {
  computeModelPerformance,
  computeRefreshAnalysis,
  computeTrueAcceptanceRate,
  computeVelocityAnalysis,
} from "../metrics/metricsEngine";
import type {
  AgentStep,
  ChatSessionRecord,
  ChatSessionRequest,
  ChatSessionTitleRecord,
  ContextFatigueMarker,
  MemoryManagementEvent,
  SessionDetailPayload,
  SessionEpisode,
  SessionSummary,
  SessionThreadSummary,
  SessionTimelineEntry,
} from "../types";

let db = new InMemoryAnalyticsDb();

/** Cached events for metrics-engine functions that require the raw list. */
let cachedEvents: TrackedEvent[] = [];
let cachedChatSessionTitles: ChatSessionTitleRecord[] = [];
let cachedChatSessions: ChatSessionRecord[] = [];

const SESSION_ACTION_GAP_MS = 5 * 60_000;
const EPISODE_ATTACHMENT_MS = 2 * 60_000;
const THREAD_ACTION_GAP_MS = 10 * 60_000;
const FATIGUE_THRESHOLD = 3;
const TYPING_SPEED_CPM = 200;
const AGENTIC_COGNITIVE_WEIGHT = 0.5;

interface EpisodeAccumulator extends SessionEpisode {
  shownCount: number;
  confirmationCount: number;
  loopCompleted: boolean;
}

interface ThreadAccumulator extends SessionThreadSummary {
  actions: ThreadActionNode[];
  signalEvents: SessionSignalEvent[];
  lastPromptAction: ThreadActionNode | null;
  activeAutonomousStartMs: number | null;
  detectedTitle: string | null;
  matchedChatTitle: string | null;
  matchedChatSessionId: string | null;
  firstUserPromptText: string | null;
  sawTitleRequest: boolean;
}

interface ThreadActionNode {
  id: string;
  threadId: string;
  sessionId: string;
  timestamp: string;
  actor: SessionTimelineEntry["actor"];
  side: "left" | "right" | "center";
  phase: SessionTimelineEntry["phase"];
  label: string;
  detail: string;
  icon: string;
  episodeId: string | null;
  intent: string;
  isAutonomous: boolean;
  isMemoryRefresh: boolean;
  children: ThreadActionNode[];
}

interface ActionVisuals {
  actor: SessionTimelineEntry["actor"];
  phase: SessionTimelineEntry["phase"];
  label: string;
  detail: string;
  icon: string;
  accepted: boolean;
  side: "left" | "right" | "center";
  isAutonomous: boolean;
  isMemoryRefresh: boolean;
}

function normaliseThreadDetail(raw: string, fallback: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function extractEditDetail(raw: string, fallback: string): string {
  const editMatch = raw.match(/workspace\/edit(?:file|File)\s+([^\s]+)/i);
  if (editMatch?.[1]) {
    return editMatch[1];
  }
  const patchMatch = raw.match(/apply_patch(?:\s+to\s+file)?\s+([^\s].*)$/i);
  if (patchMatch?.[1]) {
    return patchMatch[1].trim();
  }
  return normaliseThreadDetail(raw, fallback);
}

function extractSearchDetail(raw: string, fallback: string): string {
  const browserMatch = raw.match(/browser(?:_|-)navigate\s+(\S+)/i);
  if (browserMatch?.[1]) {
    return browserMatch[1];
  }
  return normaliseThreadDetail(raw, fallback);
}

function summariseDetail(raw: string, fallback: string, maxLength = 96): string {
  const detail = normaliseThreadDetail(raw, fallback);
  if (detail.length <= maxLength) {
    return detail;
  }
  return `${detail.slice(0, maxLength - 1).trimEnd()}…`;
}

function humaniseIntent(intent: string): string {
  if (!intent) {
    return "Activity";
  }
  return intent
    .replace(/^tool\//, "")
    .replace(/^browser\//, "browser ")
    .replace(/^reference\//, "reference ")
    .replace(/[/_-]+/g, " ")
    .trim();
}

function formatMemoryDetail(intent: string, raw: string): string {
  if (intent) {
    return humaniseIntent(intent);
  }
  return summariseDetail(raw, "Memory file");
}

function formatReferenceDetail(intent: string, raw: string): string {
  const source = intent.startsWith("reference/") ? intent.slice("reference/".length) : intent;
  return summariseDetail(raw, humaniseIntent(source || "reference"));
}

function formatSearchSignalDetail(event: SessionSignalEvent): string {
  if (event.intent === "tool/searchSubagentTool") {
    return summariseDetail(event.rawText, "Search request");
  }
  if (event.intent.startsWith("browser/")) {
    return extractSearchDetail(event.rawText, humaniseIntent(event.intent));
  }
  return summariseDetail(event.rawText, humaniseIntent(event.intent || event.signalType));
}

function formatThoughtDetail(event: SessionSignalEvent): string {
  if (event.intent === "vscodePrompt") {
    return summariseThreadPrompt(event.rawText) ?? "Prompt";
  }
  if (
    event.intent === "apply_patch" ||
    event.intent === "workspace/editfile" ||
    event.intent === "workspace/editFile"
  ) {
    return extractEditDetail(event.rawText, humaniseIntent(event.intent));
  }
  if (event.intent === "terminal/runCommand" || event.signalType === "command-executed") {
    return summariseDetail(event.rawText, "Run command");
  }
  if (event.phase === "research") {
    return formatSearchSignalDetail(event);
  }
  if (event.signalType === "reference-used") {
    return formatReferenceDetail(event.intent, event.rawText);
  }
  if (event.signalType === "memory-boundary") {
    return formatMemoryDetail(event.intent, event.rawText);
  }
  if (event.intent) {
    return summariseDetail(event.rawText, humaniseIntent(event.intent));
  }
  if (event.modelName) {
    return event.modelName;
  }
  return summariseDetail(event.rawText, humaniseIntent(event.signalType));
}

function toIsoTimestamp(timestamp: number, fallback: string, offsetMs = 0): string {
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp + offsetMs).toISOString();
  }
  return new Date(Date.parse(fallback) + offsetMs).toISOString();
}

function flattenToolCalls(toolCalls: ChatSessionRequest["toolCalls"]): ChatSessionRequest["toolCalls"] {
  const flattened: ChatSessionRequest["toolCalls"] = [];
  for (const toolCall of toolCalls) {
    flattened.push(toolCall);
    if (toolCall.childToolCalls?.length) {
      flattened.push(...flattenToolCalls(toolCall.childToolCalls));
    }
  }
  return flattened;
}

function mapToolCallToStep(
  toolCall: ChatSessionRequest["toolCalls"][number],
  baseTimestamp: number,
  fallbackTimestamp: string,
  index: number,
): AgentStep {
  const lowerName = toolCall.name.toLowerCase();
  let label: AgentStep["label"] = "Activity";
  let actor: AgentStep["actor"] = "ai";
  let phase: AgentStep["phase"] = "execution";
  let isFallback = true;

  if (/(apply_patch|workspace\/editfile|workspace\/editfile|editfile|edit-file)/.test(lowerName)) {
    label = "Updated";
    isFallback = false;
  } else if (/(terminal|runinterminal|runcommand|exec|command)/.test(lowerName)) {
    label = "Executed";
    isFallback = false;
  } else if (/(search|browser|navigate|grep|find|fetch|web)/.test(lowerName)) {
    label = "Searched";
    phase = "research";
    isFallback = false;
  } else if (/(compact|memory|context_limit|summarize)/.test(lowerName)) {
    label = "Memory file";
    actor = "system";
    phase = "memory";
    isFallback = false;
  } else if (/(reference|context)/.test(lowerName)) {
    label = "Used reference";
    actor = "system";
    phase = "research";
    isFallback = false;
  } else {
    label = "Thought";
  }

  const detailParts = [toolCall.subagentDescription, toolCall.mcpServer, toolCall.args]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  const detail = detailParts[0] ?? humaniseIntent(toolCall.name);
  return {
    timestamp: toIsoTimestamp(baseTimestamp, fallbackTimestamp, index + 2),
    actor,
    phase,
    label,
    detail: summariseDetail(detail, humaniseIntent(toolCall.name)),
    rawIntent: toolCall.name,
    isFallback,
  };
}

function buildChatSessionSteps(session: ChatSessionRecord): { steps: AgentStep[]; longestPauseMs: number } {
  const sortedRequests = [...session.requests].sort((left, right) => left.timestamp - right.timestamp);
  const steps: AgentStep[] = [];
  const fallbackTimestamp = session.createdAt;

  for (const request of sortedRequests) {
    const requestTimestamp = toIsoTimestamp(request.timestamp, fallbackTimestamp);
    if (request.messageText.trim()) {
      steps.push({
        timestamp: requestTimestamp,
        actor: "human",
        phase: "human",
        label: "Prompt",
        detail: summariseDetail(request.messageText, "Prompt"),
        rawIntent: "chat/request",
      });
    }

    const flattenedToolCalls = flattenToolCalls(request.toolCalls);
    if (flattenedToolCalls.length === 0) {
      steps.push({
        timestamp: toIsoTimestamp(request.timestamp, fallbackTimestamp, 1),
        actor: "ai",
        phase: "execution",
        label: "Thought",
        detail: summariseDetail(
          request.customAgentName ?? request.modelId,
          request.customAgentName ? `Agent ${request.customAgentName}` : request.modelId || "Assistant response",
        ),
        rawIntent: request.agentId || "chat/response",
        isFallback: true,
      });
      continue;
    }

    steps.push({
      timestamp: toIsoTimestamp(request.timestamp, fallbackTimestamp, 1),
      actor: "ai",
      phase: "planning",
      label: "Thought",
      detail: summariseDetail(
        request.customAgentName ??
          `${flattenedToolCalls.length} tool call${flattenedToolCalls.length === 1 ? "" : "s"}`,
        request.modelId || "Assistant planning",
      ),
      rawIntent: request.agentId || "chat/response",
      isFallback: true,
    });

    flattenedToolCalls.forEach((toolCall, index) => {
      steps.push(mapToolCallToStep(toolCall, request.timestamp, fallbackTimestamp, index));
    });
  }

  steps.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  let longestPauseMs = 0;
  for (let index = 0; index < steps.length - 1; index++) {
    const current = steps[index];
    const next = steps[index + 1];
    if (!current || !next) {
      continue;
    }
    const durationMs = Math.max(0, Date.parse(next.timestamp) - Date.parse(current.timestamp));
    current.durationMs = durationMs;
    current.isSignificantPause = durationMs > THREAD_ACTION_GAP_MS;
    if (durationMs > longestPauseMs) {
      longestPauseMs = durationMs;
    }
  }

  return { steps, longestPauseMs };
}

function sortEvents(events: TrackedEvent[]): TrackedEvent[] {
  return [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function isSessionSignalEvent(event: TrackedEvent): event is SessionSignalEvent {
  return event.eventType === "sessionSignal";
}

function isAdvancedSession(events: TrackedEvent[]): boolean {
  return events.some((event) => event.eventType !== "sessionSignal");
}

function isActionableEvent(event: TrackedEvent): boolean {
  if (event.eventType === "editorSwitch") {
    return false;
  }
  if (event.eventType !== "sessionSignal") {
    return true;
  }
  if (event.signalType === "thread-title") {
    return false;
  }
  if (event.intent === "title" || event.intent === "progressMessages") {
    return false;
  }
  return event.signalType !== "completion-shown";
}

function isThreadMetadataIntent(event: TrackedEvent): boolean {
  return isSessionSignalEvent(event) && (event.intent === "title" || event.intent === "progressMessages");
}

function groupEventsBySession(events: TrackedEvent[]): Map<string, TrackedEvent[]> {
  const grouped = new Map<string, TrackedEvent[]>();
  for (const event of sortEvents(events)) {
    const existing = grouped.get(event.sessionId) ?? [];
    existing.push(event);
    grouped.set(event.sessionId, existing);
  }
  return grouped;
}

function computeSessionShown(events: TrackedEvent[]): number {
  return events.filter(
    (event) => event.eventType === "sessionSignal" && event.signalType === "completion-shown" && event.success,
  ).length;
}

function computeSessionAutonomousDuration(events: TrackedEvent[]): number {
  let activeStartMs: number | null = null;
  let duration = 0;
  for (const event of events) {
    if (event.eventType === "sessionSignal") {
      if (
        event.signalType === "chat-request" &&
        event.actor === "ai" &&
        event.phase === "execution" &&
        activeStartMs === null
      ) {
        activeStartMs = new Date(event.timestamp).getTime();
      }
      if (event.signalType === "tool-loop-stop" && activeStartMs !== null) {
        const stopMs = new Date(event.timestamp).getTime();
        if (stopMs > activeStartMs) {
          duration += stopMs - activeStartMs;
        }
        activeStartMs = null;
      }
      if (event.signalType === "memory-boundary") {
        activeStartMs = null;
      }
    }
  }
  return duration;
}

function computeEfficiencyScore(events: TrackedEvent[], trueRate: number): number {
  const actionableCount = events.filter(isActionableEvent).length;
  const acceptedCount = events.filter((event) => event.eventType === "completionAccept").length;
  const retainedRatio = actionableCount > 0 ? (acceptedCount / actionableCount) * 100 : 0;
  return Math.max(0, Math.min(100, trueRate * 0.7 + retainedRatio * 0.3));
}

function buildSessionSummary(sessionId: string, events: TrackedEvent[], title: string | null = null): SessionSummary {
  const sortedEvents = sortEvents(events);
  const totalShown = computeSessionShown(sortedEvents);
  const fallbackShown = sortedEvents.filter((event) => event.eventType === "completionAccept").length;
  const trueAcceptance = computeTrueAcceptanceRate(sortedEvents, totalShown > 0 ? totalShown : fallbackShown);
  const autonomousDuration = computeSessionAutonomousDuration(sortedEvents);
  return {
    sessionId,
    title,
    date: sortedEvents[0]?.timestamp.slice(0, 10) ?? "",
    totalActions: sortedEvents.filter(isActionableEvent).length,
    trueRate: trueAcceptance.trueRate,
    autonomousDuration,
    efficiencyScore: computeEfficiencyScore(sortedEvents, trueAcceptance.trueRate),
  };
}

function getTimelineVisuals(event: TrackedEvent): ActionVisuals {
  if (event.eventType === "textChange") {
    return {
      actor: "human",
      phase: "human",
      label: "Text change",
      detail: `+${event.charsAdded} / -${event.charsDeleted}`,
      icon: "✍️",
      accepted: event.charsAdded > 0,
      side: "left",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.eventType === "completionAccept") {
    return {
      actor: "human",
      phase: "human",
      label: "Completion accepted",
      detail: event.modelName || "Inline completion",
      icon: "✅",
      accepted: true,
      side: "left",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.eventType === "editorSwitch") {
    return {
      actor: "human",
      phase: "human",
      label: "Editor switch",
      detail: event.filePath,
      icon: "📄",
      accepted: false,
      side: "left",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.intent === "vscodePrompt") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "New chat prompt",
      detail: "New Chat",
      icon: "💬",
      accepted: false,
      side: "left",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.intent === "copilotLanguageModelWrapper") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Conversation turn",
      detail: event.modelName || "Chat wrapper",
      icon: "💬",
      accepted: false,
      side: "left",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.signalType === "plan-proposal") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Plan proposed",
      detail: event.intent || event.rawText,
      icon: "🧭",
      accepted: false,
      side: event.actor === "human" ? "left" : "right",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.signalType === "memory-boundary") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Memory Refreshed",
      detail: event.intent,
      icon: "🧼",
      accepted: false,
      side: "center",
      isAutonomous: false,
      isMemoryRefresh: true,
    };
  }
  if (event.signalType === "reference-used") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Reference used",
      detail: normaliseThreadDetail(event.rawText, event.intent),
      icon: "📚",
      accepted: false,
      side: "center",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.signalType === "command-executed") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Command executed",
      detail: normaliseThreadDetail(event.rawText, event.intent),
      icon: "⌘",
      accepted: false,
      side: "right",
      isAutonomous: true,
      isMemoryRefresh: false,
    };
  }
  if (event.signalType === "tool-loop-stop") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Autonomous loop completed",
      detail: event.modelName || event.intent,
      icon: "🏁",
      accepted: true,
      side: "center",
      isAutonomous: true,
      isMemoryRefresh: false,
    };
  }
  if (event.signalType === "user-choice") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "User choice",
      detail: event.rawText,
      icon: "🧑",
      accepted: false,
      side: "left",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }
  if (event.signalType === "completion-shown") {
    return {
      actor: "ai",
      phase: "execution",
      label: "Suggestion shown",
      detail: event.modelName,
      icon: "💡",
      accepted: false,
      side: "right",
      isAutonomous: false,
      isMemoryRefresh: false,
    };
  }

  if (event.intent === "apply_patch") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Apply patch",
      detail: extractEditDetail(event.rawText, event.intent),
      icon: "🩹",
      accepted: false,
      side: "right",
      isAutonomous: true,
      isMemoryRefresh: false,
    };
  }

  if (event.intent === "workspace/editfile" || event.intent === "workspace/editFile") {
    return {
      actor: event.actor,
      phase: event.phase,
      label: "Edit file",
      detail: extractEditDetail(event.rawText, event.intent),
      icon: "📝",
      accepted: false,
      side: "right",
      isAutonomous: true,
      isMemoryRefresh: false,
    };
  }

  if (event.intent.startsWith("browser/")) {
    const browserType = event.intent.slice("browser/".length) || "browser";
    const browserLabel =
      browserType === "navigate"
        ? "Browser navigate"
        : browserType === "screenshot"
          ? "Browser screenshot"
          : "Browser research";
    return {
      actor: event.actor,
      phase: event.phase,
      label: browserLabel,
      detail: extractSearchDetail(event.rawText, browserType),
      icon: browserType === "navigate" ? "🌐" : browserType === "screenshot" ? "📸" : "🔎",
      accepted: false,
      side: "right",
      isAutonomous: true,
      isMemoryRefresh: false,
    };
  }

  const isAutonomous =
    isSubagentIntent(event.intent) ||
    event.intent === "apply_patch" ||
    event.intent === "workspace/editfile" ||
    event.intent === "workspace/editFile";
  return {
    actor: event.actor,
    phase: event.phase,
    label:
      event.phase === "research"
        ? "Research action"
        : event.phase === "execution"
          ? "Execution action"
          : "Chat request",
    detail: event.intent || event.modelName,
    icon: event.phase === "research" ? "🔎" : event.actor === "ai" ? "🤖" : "💬",
    accepted: false,
    side: event.actor === "human" ? "left" : event.actor === "system" ? "center" : "right",
    isAutonomous,
    isMemoryRefresh: false,
  };
}

function summariseEpisode(episode: SessionEpisode): string {
  if (episode.contextBoundary) {
    return "Context refresh boundary reached";
  }
  if (episode.accepted) {
    return "Human confirmed the episode outcome";
  }
  if (episode.aiActionCount > episode.humanActionCount) {
    return "AI actions outpaced human confirmation";
  }
  return "Human-led interaction";
}

function hasMeaningfulEpisodeActivity(episode: EpisodeAccumulator): boolean {
  return episode.aiActionCount > 0 || episode.humanActionCount > 0 || episode.shownCount > 0;
}

function toPublicEpisode(episode: EpisodeAccumulator): SessionEpisode {
  return {
    episodeId: episode.episodeId,
    sessionId: episode.sessionId,
    startedAt: episode.startedAt,
    endedAt: episode.endedAt,
    phases: [...episode.phases],
    aiActionCount: episode.aiActionCount,
    humanActionCount: episode.humanActionCount,
    accepted: episode.accepted,
    contextBoundary: episode.contextBoundary,
    models: [...episode.models],
    summary: episode.summary,
    fatigueScore: episode.fatigueScore,
  };
}

function computeEpisodeTrueRate(episodes: EpisodeAccumulator[], endIndex: number): number {
  const recent = episodes.slice(Math.max(0, endIndex - 2), endIndex + 1);
  const shownTotal = recent.reduce((sum, episode) => sum + episode.shownCount, 0);
  if (shownTotal > 0) {
    const confirmed = recent.reduce((sum, episode) => sum + episode.confirmationCount, 0);
    return (confirmed / shownTotal) * 100;
  }
  const acceptedEpisodes = recent.filter((episode) => episode.accepted).length;
  return (acceptedEpisodes / Math.max(1, recent.length)) * 100;
}

function computeEpisodeTrendPenalty(
  episodes: EpisodeAccumulator[],
  index: number,
  baselineTrueRate: number,
): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const recentTrueRate = computeEpisodeTrueRate(episodes, index);
  const previousTrueRate = index > 0 ? computeEpisodeTrueRate(episodes, index - 1) : recentTrueRate;
  const floor = baselineTrueRate > 0 ? Math.max(20, baselineTrueRate * 0.75) : 35;
  if (recentTrueRate < floor) {
    score++;
    reasons.push("episode true-rate weakened");
  }
  if (index > 0 && previousTrueRate - recentTrueRate >= 15) {
    score++;
    reasons.push("episode true-rate dropped sharply");
  }
  return { score, reasons };
}

function isThreadBoundaryPrompt(event: TrackedEvent): boolean {
  return event.eventType === "sessionSignal" && event.intent === "vscodePrompt";
}

function isAutonomousSignal(event: TrackedEvent): boolean {
  return (
    event.eventType === "sessionSignal" &&
    (isSubagentIntent(event.intent) ||
      event.intent === "apply_patch" ||
      event.intent === "workspace/editfile" ||
      event.intent === "workspace/editFile" ||
      event.intent.startsWith("browser/") ||
      event.signalType === "tool-loop-stop")
  );
}

function toAgentStep(event: SessionSignalEvent): AgentStep | null {
  if (event.intent === "title" || event.intent === "progressMessages" || event.signalType === "thread-title") {
    return null;
  }
  if (event.signalType === "completion-shown" || event.signalType === "tool-loop-stop") {
    return null;
  }

  if (event.intent === "vscodePrompt") {
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label: "Prompt",
      detail: summariseThreadPrompt(event.rawText) ?? "Prompt",
      rawIntent: event.intent,
    };
  }

  if (
    event.intent === "apply_patch" ||
    event.intent === "workspace/editfile" ||
    event.intent === "workspace/editFile"
  ) {
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label: "Updated",
      detail: extractEditDetail(event.rawText, humaniseIntent(event.intent)),
      rawIntent: event.intent,
    };
  }

  if (event.intent === "terminal/runCommand" || event.signalType === "command-executed") {
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label: "Executed",
      detail: summariseDetail(event.rawText, "Run command"),
      rawIntent: event.intent,
    };
  }

  if (
    (event.phase === "research" && event.intent.startsWith("browser/")) ||
    event.intent === "tool/searchSubagentTool" ||
    event.signalType === "reference-used"
  ) {
    if (event.signalType === "reference-used") {
      return {
        timestamp: event.timestamp,
        actor: event.actor,
        phase: event.phase,
        label: "Used reference",
        detail: formatReferenceDetail(event.intent, event.rawText),
        rawIntent: event.intent,
      };
    }
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label: "Searched",
      detail: formatSearchSignalDetail(event),
      rawIntent: event.intent,
    };
  }

  if (event.signalType === "memory-boundary") {
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label: "Memory file",
      detail: formatMemoryDetail(event.intent, event.rawText),
      rawIntent: event.intent,
    };
  }

  if (event.actor === "ai" && event.phase === "planning") {
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label:
        event.signalType === "plan-proposal" ||
        event.intent === "panel/unknown" ||
        event.intent === "agent/plan" ||
        event.intent === "strategy/propose"
          ? "Considered"
          : "Evaluating",
      detail: formatThoughtDetail(event),
      rawIntent: event.intent,
    };
  }

  if (event.actor === "ai") {
    return {
      timestamp: event.timestamp,
      actor: event.actor,
      phase: event.phase,
      label: "Thought",
      detail: formatThoughtDetail(event),
      rawIntent: event.intent,
      isFallback: true,
    };
  }

  return {
    timestamp: event.timestamp,
    actor: event.actor,
    phase: event.phase,
    label: "Activity",
    detail: formatThoughtDetail(event),
    rawIntent: event.intent,
    isFallback: true,
  };
}

function buildAgentSteps(signalEvents: SessionSignalEvent[]): { steps: AgentStep[]; longestPauseMs: number } {
  const steps = signalEvents
    .map(toAgentStep)
    .filter((step): step is AgentStep => step !== null)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  let longestPauseMs = 0;
  for (let index = 0; index < steps.length - 1; index++) {
    const current = steps[index];
    const next = steps[index + 1];
    if (!current || !next) {
      continue;
    }
    const durationMs = Math.max(0, Date.parse(next.timestamp) - Date.parse(current.timestamp));
    current.durationMs = durationMs;
    current.isSignificantPause = durationMs > THREAD_ACTION_GAP_MS;
    if (durationMs > longestPauseMs) {
      longestPauseMs = durationMs;
    }
  }
  return { steps, longestPauseMs };
}

function finalizeThread(thread: ThreadAccumulator): SessionThreadSummary {
  return {
    threadId: thread.threadId,
    title: thread.title,
    startedAt: thread.startedAt,
    estimatedMinutesSaved: thread.estimatedMinutesSaved,
    autonomousDurationMs: thread.autonomousDurationMs,
    acceptedChars: thread.acceptedChars,
    hasAutonomousRun: thread.hasAutonomousRun,
    stepCount: thread.stepCount,
    longestPauseMs: thread.longestPauseMs,
    hasSelectableTitle: thread.hasSelectableTitle,
  };
}

function summariseThreadPrompt(rawText: string): string | null {
  const cleaned = rawText
    .replace(/\s+/g, " ")
    .replace(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?(?:\s*\[[^\]]+\])?\s*/i, "")
    .replace(/^ccreq:[^|]+\|\s*success\s*\|\s*[^|]+\|\s*\d+ms\s*\|\s*/i, "")
    .replace(/\[[^\]]+\]\s*$/g, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  if (
    !cleaned ||
    /^vscodeprompt$/i.test(cleaned) ||
    /^copilotlanguagemodelwrapper$/i.test(cleaned) ||
    /^chat-request$/i.test(cleaned) ||
    /^text change$/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned.slice(0, 80);
}

function getSyntheticThreadLabel(action: ThreadActionNode | undefined, sawTitleRequest: boolean): string {
  if (!action) {
    return sawTitleRequest ? "Chat thread" : "Conversation";
  }
  switch (action.label) {
    case "Conversation turn":
    case "New chat prompt":
    case "Chat request":
      return sawTitleRequest ? "Titled chat" : "Conversation";
    case "Plan proposed":
      return "Planning thread";
    case "Research action":
      return "Research thread";
    case "Execution action":
      return "Execution thread";
    case "Edit file":
      return "Editing thread";
    case "Apply patch":
      return "Patch thread";
    default:
      return action.label;
  }
}

function normalisePromptText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function chooseMatchingChatTitle(
  thread: ThreadAccumulator,
  records: ChatSessionTitleRecord[],
  usedSessionIds: Set<string>,
): ChatSessionTitleRecord | null {
  const threadStartMs = Date.parse(thread.startedAt);
  if (Number.isNaN(threadStartMs)) {
    return null;
  }
  const maxGapMs = thread.sawTitleRequest ? 2 * 60 * 60_000 : 30 * 60_000;
  const threadPrompt = normalisePromptText(thread.firstUserPromptText);
  let best: { record: ChatSessionTitleRecord; score: number } | null = null;

  for (const record of records) {
    if (usedSessionIds.has(record.chatSessionId)) {
      continue;
    }
    const createdAtMs = Date.parse(record.createdAt);
    if (Number.isNaN(createdAtMs)) {
      continue;
    }
    const deltaMs = Math.abs(createdAtMs - threadStartMs);
    if (deltaMs > maxGapMs) {
      continue;
    }
    let score = deltaMs;
    const recordPrompt = normalisePromptText(record.firstRequestText);
    if (threadPrompt && recordPrompt) {
      if (threadPrompt === recordPrompt) {
        score -= 10 * 60_000;
      } else if (threadPrompt.includes(recordPrompt) || recordPrompt.includes(threadPrompt)) {
        score -= 5 * 60_000;
      }
    }
    if (!best || score < best.score) {
      best = { record, score };
    }
  }

  return best?.record ?? null;
}

function chooseMatchingChatSession(
  thread: ThreadAccumulator,
  records: ChatSessionRecord[],
  usedSessionIds: Set<string>,
): ChatSessionRecord | null {
  const threadStartMs = Date.parse(thread.startedAt);
  if (Number.isNaN(threadStartMs)) {
    return null;
  }
  const maxGapMs = thread.sawTitleRequest ? 2 * 60 * 60_000 : 30 * 60_000;
  const threadPrompt = normalisePromptText(thread.firstUserPromptText);
  let best: { record: ChatSessionRecord; score: number } | null = null;

  for (const record of records) {
    if (usedSessionIds.has(record.chatSessionId)) {
      continue;
    }
    const createdAtMs = Date.parse(record.createdAt);
    if (Number.isNaN(createdAtMs)) {
      continue;
    }
    const deltaMs = Math.abs(createdAtMs - threadStartMs);
    if (deltaMs > maxGapMs) {
      continue;
    }
    let score = deltaMs;
    const recordPrompt = normalisePromptText(record.firstRequestText);
    if (threadPrompt && recordPrompt) {
      if (threadPrompt === recordPrompt) {
        score -= 10 * 60_000;
      } else if (threadPrompt.includes(recordPrompt) || recordPrompt.includes(threadPrompt)) {
        score -= 5 * 60_000;
      }
    }
    if (record.title && thread.matchedChatTitle && record.title === thread.matchedChatTitle) {
      score -= 15 * 60_000;
    }
    if (!best || score < best.score) {
      best = { record, score };
    }
  }

  return best?.record ?? null;
}

function applyWorkspaceChatTitles(
  threads: ThreadAccumulator[],
  titleRecords: ChatSessionTitleRecord[],
  chatSessions: ChatSessionRecord[],
  sessionStartedAt: string,
  sessionEndedAt: string,
): void {
  const sessionStartMs = Date.parse(sessionStartedAt);
  const sessionEndMs = Date.parse(sessionEndedAt);
  if (Number.isNaN(sessionStartMs) || Number.isNaN(sessionEndMs)) {
    return;
  }

  const candidateRecords = titleRecords.filter((record) => {
    const createdAtMs = Date.parse(record.createdAt);
    return (
      !Number.isNaN(createdAtMs) &&
      createdAtMs >= sessionStartMs - 6 * 60 * 60_000 &&
      createdAtMs <= sessionEndMs + 6 * 60 * 60_000
    );
  });
  const usedSessionIds = new Set<string>();
  const candidateSessions = chatSessions.filter((record) => {
    const createdAtMs = Date.parse(record.createdAt);
    return (
      !Number.isNaN(createdAtMs) &&
      createdAtMs >= sessionStartMs - 6 * 60 * 60_000 &&
      createdAtMs <= sessionEndMs + 6 * 60 * 60_000
    );
  });

  for (const thread of threads) {
    const matchedRecord = chooseMatchingChatTitle(thread, candidateRecords, usedSessionIds);
    if (matchedRecord) {
      thread.matchedChatTitle = matchedRecord.title;
      thread.matchedChatSessionId = matchedRecord.chatSessionId;
      usedSessionIds.add(matchedRecord.chatSessionId);
      continue;
    }

    const matchedSession = chooseMatchingChatSession(thread, candidateSessions, usedSessionIds);
    if (!matchedSession) {
      continue;
    }
    thread.matchedChatSessionId = matchedSession.chatSessionId;
    thread.matchedChatTitle = matchedSession.title;
    usedSessionIds.add(matchedSession.chatSessionId);
  }
}

function buildThreadTitle(thread: ThreadAccumulator): [string, boolean] {
  if (thread.matchedChatTitle) {
    return [thread.matchedChatTitle, true];
  }
  if (thread.detectedTitle) {
    return [thread.detectedTitle, true];
  }
  if (thread.firstUserPromptText) {
    const promptTitle = summariseThreadPrompt(thread.firstUserPromptText);
    if (promptTitle) {
      return [promptTitle, true];
    }
  }
  const firstAction = thread.actions[0];
  if (firstAction?.label === "New chat prompt") {
    return [
      `New Chat · ${new Date(firstAction.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      false,
    ];
  }
  if (firstAction) {
    return [
      `${getSyntheticThreadLabel(firstAction, thread.sawTitleRequest)} · ${new Date(firstAction.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      false,
    ];
  }
  return [thread.title, false];
}

function buildThreadAction(
  event: TrackedEvent,
  sessionId: string,
  threadId: string,
  episodeId: string | null,
): ThreadActionNode {
  const visuals = getTimelineVisuals(event);
  return {
    id: `${threadId}:${event.timestamp}:${event.eventType}:${episodeId ?? "root"}`,
    threadId,
    sessionId,
    timestamp: event.timestamp,
    actor: visuals.actor,
    side: visuals.side,
    phase: visuals.phase,
    label: visuals.label,
    detail: visuals.detail,
    icon: visuals.icon,
    episodeId,
    intent: event.eventType === "sessionSignal" ? event.intent : "",
    isAutonomous: visuals.isAutonomous,
    isMemoryRefresh: visuals.isMemoryRefresh,
    children: [],
  };
}

function buildThreadDrilldown(
  sessionId: string,
  events: TrackedEvent[],
  timeline: SessionTimelineEntry[],
  titleRecords: ChatSessionTitleRecord[],
  chatSessions: ChatSessionRecord[],
): {
  threads: SessionThreadSummary[];
  stepsByThread: Record<string, AgentStep[]>;
  matchedChatTitlesByThread: Record<string, string>;
} {
  const actionableEvents = events.filter((event) => event.eventType !== "editorSwitch");
  const episodeByActionId = new Map<string, string | null>();
  for (const entry of timeline) {
    episodeByActionId.set(`${entry.timestamp}:${entry.label}:${entry.actor}`, entry.episodeId);
  }

  const threads: ThreadAccumulator[] = [];
  let currentThread: ThreadAccumulator | null = null;
  let threadCounter = 0;
  let lastThreadEventMs: number | null = null;

  const createThread = (timestamp: string): ThreadAccumulator => ({
    threadId: `thread-${++threadCounter}`,
    title: `Thread ${threadCounter}`,
    startedAt: timestamp,
    estimatedMinutesSaved: 0,
    autonomousDurationMs: 0,
    acceptedChars: 0,
    hasAutonomousRun: false,
    stepCount: 0,
    longestPauseMs: 0,
    hasSelectableTitle: false,
    actions: [],
    signalEvents: [],
    lastPromptAction: null,
    activeAutonomousStartMs: null,
    detectedTitle: null,
    matchedChatTitle: null,
    matchedChatSessionId: null,
    firstUserPromptText: null,
    sawTitleRequest: false,
  });

  let pendingDetectedTitle: string | null = null;
  let pendingTitleRequest = false;

  const closeAutonomousRun = (thread: ThreadAccumulator, stopTimestamp: string) => {
    if (thread.activeAutonomousStartMs === null) {
      return;
    }
    const stopMs = new Date(stopTimestamp).getTime();
    if (stopMs > thread.activeAutonomousStartMs) {
      thread.autonomousDurationMs += stopMs - thread.activeAutonomousStartMs;
      thread.hasAutonomousRun = true;
    }
    thread.activeAutonomousStartMs = null;
  };

  for (const event of actionableEvents) {
    if (isSessionSignalEvent(event) && event.signalType === "thread-title") {
      if (currentThread) {
        currentThread.detectedTitle = event.rawText;
      } else {
        pendingDetectedTitle = event.rawText;
      }
      continue;
    }

    if (isThreadMetadataIntent(event)) {
      if (isSessionSignalEvent(event) && event.intent === "title") {
        if (currentThread) {
          currentThread.sawTitleRequest = true;
        } else {
          pendingTitleRequest = true;
        }
      }
      lastThreadEventMs = new Date(event.timestamp).getTime();
      continue;
    }

    const eventMs = new Date(event.timestamp).getTime();
    const shouldStartNewThread =
      currentThread === null ||
      (lastThreadEventMs !== null && eventMs - lastThreadEventMs >= THREAD_ACTION_GAP_MS) ||
      (isThreadBoundaryPrompt(event) && currentThread.actions.length > 0);

    if (shouldStartNewThread) {
      if (currentThread) {
        closeAutonomousRun(currentThread, currentThread.actions.at(-1)?.timestamp ?? currentThread.startedAt);
        threads.push(currentThread);
      }
      currentThread = createThread(event.timestamp);
      if (pendingDetectedTitle) {
        currentThread.detectedTitle = pendingDetectedTitle;
        pendingDetectedTitle = null;
      }
      if (pendingTitleRequest) {
        currentThread.sawTitleRequest = true;
        pendingTitleRequest = false;
      }
    }

    const thread = currentThread;
    if (!thread) {
      continue;
    }

    const visuals = getTimelineVisuals(event);
    const episodeId = episodeByActionId.get(`${event.timestamp}:${visuals.label}:${visuals.actor}`) ?? null;
    const action = buildThreadAction(event, sessionId, thread.threadId, episodeId);

    if (isSessionSignalEvent(event) && event.actor === "human" && thread.firstUserPromptText === null) {
      thread.firstUserPromptText = event.rawText;
    }

    if (isSessionSignalEvent(event)) {
      thread.signalEvents.push(event);
    }

    if (event.eventType === "textChange" && event.charsAdded > 0) {
      thread.acceptedChars += event.charsAdded;
    }

    if (isSessionSignalEvent(event)) {
      if (
        event.signalType === "chat-request" &&
        event.actor === "ai" &&
        event.phase === "execution" &&
        isAutonomousSignal(event) &&
        thread.activeAutonomousStartMs === null
      ) {
        thread.activeAutonomousStartMs = eventMs;
      }
      if (event.signalType === "tool-loop-stop" || event.signalType === "memory-boundary") {
        closeAutonomousRun(thread, event.timestamp);
      }
    }

    if (action.isAutonomous) {
      thread.hasAutonomousRun = true;
    }

    if (action.side === "left") {
      thread.actions.push(action);
      thread.lastPromptAction =
        action.label === "Text change" || action.label === "Completion accepted" ? null : action;
    } else if (action.isMemoryRefresh || action.side === "center") {
      thread.actions.push(action);
    } else if (thread.lastPromptAction) {
      thread.lastPromptAction.children.push(action);
    } else {
      thread.actions.push(action);
    }

    lastThreadEventMs = eventMs;
  }

  if (currentThread) {
    closeAutonomousRun(currentThread, currentThread.actions.at(-1)?.timestamp ?? currentThread.startedAt);
    threads.push(currentThread);
  }

  if (threads.length > 0) {
    applyWorkspaceChatTitles(
      threads,
      titleRecords,
      chatSessions,
      events[0]?.timestamp ?? threads[0].startedAt,
      events.at(-1)?.timestamp ?? threads.at(-1)?.startedAt ?? threads[0].startedAt,
    );
  }

  const chatSessionsById = new Map(chatSessions.map((record) => [record.chatSessionId, record]));

  const stepsByThread = Object.fromEntries(
    threads.map((thread) => {
      const matchedSession = thread.matchedChatSessionId
        ? chatSessionsById.get(thread.matchedChatSessionId)
        : undefined;
      const built = matchedSession ? buildChatSessionSteps(matchedSession) : buildAgentSteps(thread.signalEvents);
      thread.stepCount = built.steps.length;
      thread.longestPauseMs = built.longestPauseMs;
      return [thread.threadId, built.steps];
    }),
  );

  const matchedChatTitlesByThread = Object.fromEntries(
    threads
      .filter((thread) => Boolean(thread.matchedChatTitle?.trim()))
      .map((thread) => [thread.threadId, thread.matchedChatTitle?.trim() ?? ""]),
  );

  const threadSummaries = threads.map((thread) => {
    const [title, hasSelectableTitle] = buildThreadTitle(thread);
    thread.title = title;
    thread.hasSelectableTitle = hasSelectableTitle;
    thread.estimatedMinutesSaved =
      thread.acceptedChars / TYPING_SPEED_CPM + (thread.autonomousDurationMs / 60_000) * AGENTIC_COGNITIVE_WEIGHT;
    return finalizeThread(thread);
  });

  return {
    threads: threadSummaries,
    stepsByThread,
    matchedChatTitlesByThread,
  };
}

export function buildSessionDetail(
  sessionId: string,
  events: TrackedEvent[],
  titleRecords: ChatSessionTitleRecord[] = [],
  chatSessions: ChatSessionRecord[] = [],
): SessionDetailPayload | null {
  const sortedEvents = sortEvents(events);
  if (sortedEvents.length === 0) {
    return null;
  }

  const summary = buildSessionSummary(sessionId, sortedEvents);
  const timeline: SessionTimelineEntry[] = [];
  const episodes: EpisodeAccumulator[] = [];
  let currentEpisode: EpisodeAccumulator | null = null;
  let episodeCounter = 0;
  let lastActionMs: number | null = null;
  let lastAiActionMs: number | null = null;

  const closeEpisode = (endedAt: string) => {
    if (!currentEpisode) {
      return;
    }
    currentEpisode.endedAt = endedAt;
    currentEpisode.summary = summariseEpisode(currentEpisode);
    episodes.push(currentEpisode);
    currentEpisode = null;
  };

  const ensureEpisode = (event: TrackedEvent): EpisodeAccumulator => {
    const eventMs = new Date(event.timestamp).getTime();
    if (currentEpisode && lastActionMs !== null && eventMs - lastActionMs > SESSION_ACTION_GAP_MS) {
      closeEpisode(currentEpisode.endedAt);
    }
    if (!currentEpisode) {
      const episodeId = `episode-${++episodeCounter}`;
      currentEpisode = {
        episodeId,
        sessionId,
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        phases: [],
        aiActionCount: 0,
        humanActionCount: 0,
        accepted: false,
        contextBoundary: false,
        models: [],
        summary: "",
        fatigueScore: 0,
        shownCount: 0,
        confirmationCount: 0,
        loopCompleted: false,
      };
    }
    return currentEpisode;
  };

  for (const event of sortedEvents) {
    if (!isActionableEvent(event)) {
      continue;
    }

    const eventMs = new Date(event.timestamp).getTime();
    if (
      currentEpisode &&
      event.eventType === "sessionSignal" &&
      event.signalType === "plan-proposal" &&
      hasMeaningfulEpisodeActivity(currentEpisode)
    ) {
      closeEpisode((currentEpisode as SessionEpisode).endedAt);
    }

    const shouldCloseCompletedLoopEpisode =
      currentEpisode !== null &&
      (currentEpisode as EpisodeAccumulator).loopCompleted &&
      event.eventType === "sessionSignal" &&
      event.signalType === "chat-request" &&
      event.actor === "ai";
    if (shouldCloseCompletedLoopEpisode) {
      closeEpisode(event.timestamp);
    }

    const episode = ensureEpisode(event);
    const visuals = getTimelineVisuals(event);

    if (!episode.phases.includes(visuals.phase)) {
      episode.phases.push(visuals.phase);
    }
    if (event.eventType === "completionAccept") {
      episode.humanActionCount++;
      episode.accepted = true;
      episode.confirmationCount++;
    } else if (event.eventType === "textChange") {
      episode.humanActionCount++;
      if (episode.aiActionCount > 0 && event.charsAdded > 0) {
        episode.accepted = true;
        episode.confirmationCount++;
      }
    } else if (event.eventType === "sessionSignal") {
      if (event.actor === "ai") {
        episode.aiActionCount++;
        lastAiActionMs = eventMs;
      } else if (event.actor === "human") {
        episode.humanActionCount++;
      }
      if (event.modelName && !episode.models.includes(event.modelName)) {
        episode.models.push(event.modelName);
      }
      if (event.signalType === "completion-shown") {
        episode.shownCount++;
      }
      if (event.signalType === "memory-boundary") {
        episode.contextBoundary = true;
      }
      if (event.signalType === "tool-loop-stop") {
        episode.loopCompleted = true;
      }
    }

    episode.endedAt = event.timestamp;
    timeline.push({
      id: `${sessionId}:${timeline.length}`,
      sessionId,
      timestamp: event.timestamp,
      actor: visuals.actor,
      phase: visuals.phase,
      label: visuals.label,
      detail: visuals.detail,
      icon: visuals.icon,
      accepted: visuals.accepted,
      episodeId: episode.episodeId,
    });

    if (event.eventType === "sessionSignal" && event.signalType === "memory-boundary") {
      closeEpisode(event.timestamp);
    }
    lastActionMs = eventMs;
  }

  closeEpisode(sortedEvents.at(-1)?.timestamp ?? summary.date);

  let fatigueMarker: ContextFatigueMarker | null = null;
  let degradedStreak = 0;
  let acceptedEpisodes = 0;
  for (const [index, episode] of episodes.entries()) {
    if (episode.accepted) {
      acceptedEpisodes++;
      degradedStreak = 0;
    } else {
      degradedStreak++;
    }

    const reasons: string[] = [];
    let score = 0;
    if (episode.aiActionCount >= 4) {
      score++;
      reasons.push("autonomous depth increased");
    }
    if (episode.phases.includes("research") && episode.phases.includes("execution") && !episode.accepted) {
      score++;
      reasons.push("research did not convert into execution outcome");
    }
    if (!episode.accepted && episode.aiActionCount > episode.humanActionCount) {
      score++;
      reasons.push("AI actions outpaced human confirmation");
    }
    if (episode.contextBoundary) {
      score += 2;
      reasons.push("refresh boundary occurred");
    }
    if (degradedStreak >= 2) {
      score++;
      reasons.push("degraded episodes continued");
    }
    if (episodes.length > 1) {
      const acceptanceRatio = acceptedEpisodes / Math.max(1, index + 1);
      if (acceptanceRatio < 0.4) {
        score++;
        reasons.push("session confirmation ratio weakened");
      }
    }
    const trendPenalty = computeEpisodeTrendPenalty(episodes, index, summary.trueRate);
    score += trendPenalty.score;
    reasons.push(...trendPenalty.reasons);
    episode.fatigueScore = score;
    if (!fatigueMarker && score >= FATIGUE_THRESHOLD) {
      fatigueMarker = {
        timestamp: episode.endedAt,
        episodeId: episode.episodeId,
        score,
        reason: reasons.join(", "),
      };
    }
  }

  const threadDrilldown = buildThreadDrilldown(sessionId, sortedEvents, timeline, titleRecords, chatSessions);

  return {
    ...summary,
    timeline,
    episodes: episodes.map(toPublicEpisode),
    fatigueMarker,
    threads: threadDrilldown.threads,
    stepsByThread: threadDrilldown.stepsByThread,
  };
}

function chooseRepresentativeSessionTitle(threads: SessionThreadSummary[]): string | null {
  const titledThreads = threads
    .filter((thread) => thread.hasSelectableTitle && thread.stepCount > 0)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));

  return titledThreads[0]?.title ?? null;
}

export function buildSessionList(
  events: TrackedEvent[],
  titleRecords: ChatSessionTitleRecord[] = [],
  chatSessions: ChatSessionRecord[] = [],
): SessionSummary[] {
  return Array.from(groupEventsBySession(events).entries())
    .filter(([, sessionEvents]) => isAdvancedSession(sessionEvents))
    .map(([sessionId, sessionEvents]) => {
      const sortedEvents = sortEvents(sessionEvents);
      if (sortedEvents.length === 0) {
        return null;
      }
      const threadDrilldown = buildThreadDrilldown(sessionId, sortedEvents, [], titleRecords, chatSessions);
      const title = chooseRepresentativeSessionTitle(threadDrilldown.threads);
      if (!title) {
        return null;
      }
      return buildSessionSummary(sessionId, sortedEvents, title);
    })
    .filter((session): session is SessionSummary => session !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.totalActions - a.totalActions);
}

/**
 * Read all JSONL event files from `<storagePath>/events/`.
 *
 * This is the Node.js equivalent of DuckDB's `read_json_auto('events/*.jsonl',
 * ignore_errors = true)` — corrupt lines are silently skipped so that a single
 * malformed entry does not abort the entire analysis.
 */
function loadJsonlDirectory(storagePath: string): TrackedEvent[] {
  const eventsDir = path.join(storagePath, "events");
  const events: TrackedEvent[] = [];
  try {
    const files = fs
      .readdirSync(eventsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    for (const file of files) {
      const filePath = path.join(eventsDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          try {
            events.push(JSON.parse(line) as TrackedEvent);
          } catch {
            // ignore malformed lines (ignore_errors equivalent)
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // events directory does not exist — return empty array
  }
  return events;
}

parentPort?.on("message", async (msg: { type: string; id?: string; payload?: unknown }) => {
  try {
    switch (msg.type) {
      case "loadFromJsonl": {
        const { storagePath } = msg.payload as { storagePath: string };
        const events = sortEvents(loadJsonlDirectory(storagePath));
        await db.close();
        db = new InMemoryAnalyticsDb();
        cachedEvents = events;
        db.ingest(events);
        const baselines = db.calculateBaselines();
        parentPort?.postMessage({ type: "loadFromJsonl", id: msg.id, result: { loaded: events.length, baselines } });
        break;
      }

      case "ingest": {
        const events = msg.payload as TrackedEvent[];
        const sortedEvents = sortEvents(events);
        cachedEvents = sortEvents(cachedEvents.concat(sortedEvents));
        db.ingest(sortedEvents);
        parentPort?.postMessage({ type: "ingest", id: msg.id, result: { ingested: events.length, total: db.size } });
        break;
      }

      case "setChatSessionTitles": {
        const titles = (msg.payload as ChatSessionTitleRecord[]) ?? [];
        cachedChatSessionTitles = [...titles].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        parentPort?.postMessage({
          type: "setChatSessionTitles",
          id: msg.id,
          result: { loaded: cachedChatSessionTitles.length },
        });
        break;
      }

      case "setChatSessions": {
        const sessions = (msg.payload as ChatSessionRecord[]) ?? [];
        cachedChatSessions = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        parentPort?.postMessage({
          type: "setChatSessions",
          id: msg.id,
          result: { loaded: cachedChatSessions.length },
        });
        break;
      }

      case "query": {
        const sql = msg.payload as string;
        const rows = await db.query(sql);
        parentPort?.postMessage({ type: "query", id: msg.id, result: rows });
        break;
      }

      case "trueRate": {
        const opts = (msg.payload ?? {}) as { totalShown?: number; windowMs?: number };
        const result = computeTrueAcceptanceRate(cachedEvents, opts.totalShown ?? 0, opts.windowMs);
        parentPort?.postMessage({ type: "trueRate", id: msg.id, result });
        break;
      }

      case "velocity": {
        const opts = (msg.payload ?? {}) as { windowMs?: number };
        const result = computeVelocityAnalysis(cachedEvents, opts.windowMs);
        parentPort?.postMessage({ type: "velocity", id: msg.id, result });
        break;
      }

      case "modelPerf": {
        const result = computeModelPerformance(cachedEvents);
        // Convert Map → Object for structured-clone compatibility
        const serialisable = {
          crossTab: result.crossTab,
          bestModelByLanguage: Object.fromEntries(result.bestModelByLanguage),
        };
        parentPort?.postMessage({ type: "modelPerf", id: msg.id, result: serialisable });
        break;
      }

      case "getRefreshAnalysis": {
        const opts = (msg.payload ?? {}) as {
          memoryEvents?: MemoryManagementEvent[];
          windowMs?: number;
          turnWindowSize?: number;
          revertWindowMs?: number;
        };
        const result = computeRefreshAnalysis(cachedEvents, opts.memoryEvents ?? [], {
          windowMs: opts.windowMs,
          turnWindowSize: opts.turnWindowSize,
          revertWindowMs: opts.revertWindowMs,
        });
        parentPort?.postMessage({ type: "getRefreshAnalysis", id: msg.id, result });
        break;
      }

      case "getSessionList": {
        const result = buildSessionList(cachedEvents, cachedChatSessionTitles, cachedChatSessions);
        parentPort?.postMessage({ type: "getSessionList", id: msg.id, result });
        break;
      }

      case "getSessionDetail": {
        const { sessionId } = (msg.payload ?? {}) as { sessionId: string };
        const sessionEvents = cachedEvents.filter((event) => event.sessionId === sessionId);
        const result = buildSessionDetail(sessionId, sessionEvents, cachedChatSessionTitles, cachedChatSessions);
        parentPort?.postMessage({ type: "getSessionDetail", id: msg.id, result });
        break;
      }

      case "baselines": {
        const opts = (msg.payload ?? {}) as { windowDays?: number };
        const result = db.calculateBaselines(opts.windowDays);
        parentPort?.postMessage({ type: "baselines", id: msg.id, result });
        break;
      }

      case "compact": {
        const opts = (msg.payload ?? {}) as { ttlMs?: number };
        const compacted = db.compact(opts.ttlMs);
        // Trim cachedEvents to match the db's TTL so metric functions stay consistent.
        const effectiveTtl = opts.ttlMs ?? 24 * 60 * 60 * 1000;
        const cutoff = new Date(Date.now() - effectiveTtl).toISOString();
        cachedEvents = cachedEvents.filter((e) => e.timestamp >= cutoff);
        parentPort?.postMessage({ type: "compact", id: msg.id, result: { compacted } });
        break;
      }

      case "close": {
        await db.close();
        db = new InMemoryAnalyticsDb();
        cachedEvents = [];
        cachedChatSessionTitles = [];
        cachedChatSessions = [];
        parentPort?.postMessage({ type: "close", id: msg.id, result: true });
        break;
      }

      default:
        parentPort?.postMessage({ type: msg.type, id: msg.id, error: `Unknown message type: ${msg.type}` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage({ type: msg.type, id: msg.id, error: message });
  }
});
