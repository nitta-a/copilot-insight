/**
 * JSON-log parser — handles structured log entries that contain embedded JSON
 * objects (`{ ... }` fragments) in Copilot extension-host log lines.
 */

import type { ParsingContext } from "../../types";
import {
  CHAT_TITLE_JSON_KEY_PATTERN,
  detectCommandUsage,
  extractThreadTitleFromPayload,
  extractTimestampFromText,
  getJsonFeatureText,
  incrementCount,
  incrementStatCount,
  maybeRecordFeatureSignals,
  normalizeContextSource,
  normalizeModelName,
  normalizeTimestamp,
  recordReferenceSignal,
  recordThreadTitleSignal,
  trackPlanningStats,
} from "./parserHelpers";

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

  // Slash command / @participant detection from JSON `command` or `action` fields.
  const rawCommand = data.command ?? data.action;
  if (typeof rawCommand === "string") {
    const detected = detectCommandUsage(rawCommand);
    if (detected) {
      incrementCount(ctx.commandUsage, detected);
    }
  }

  if (featureText) {
    maybeRecordFeatureSignals(featureText, ctx, timestamp);
  }

  // Planning & Execution: check event name for plan/execution signals.
  trackPlanningStats(eventLower, ctx, timestamp, event);

  // ── Chat Session Turn Tracking ────────────────────────────────────────────
  // Only track sessions that carry an explicit session identifier in the log
  // data. Sessions without an ID are silently skipped to avoid polluting stats
  // with synthetic session buckets. Falls back to ctx.currentSessionId only
  // when the data fields are absent but the context has a non-empty value.
  const rawSessionId = data.sessionId ?? data.chatSessionId ?? data.conversationId ?? ctx.currentSessionId;
  if (typeof rawSessionId === "string" && rawSessionId) {
    const isChatTurn =
      eventLower.includes("chat/request") ||
      eventLower.includes("chat.request") ||
      eventLower.includes("chatrequest") ||
      eventLower.includes("message.sent") ||
      eventLower.includes("conversation.request");
    // Detect code-acceptance actions: codeblock copy, editor apply/insert,
    // and apply_patch. Using suffixed patterns to avoid false positives on
    // event names that merely contain these words in other contexts.
    const isCodeAction =
      eventLower.includes("code.copy") ||
      eventLower.includes("codeblock.copy") ||
      eventLower.includes(".copy") ||
      eventLower.includes("code.apply") ||
      eventLower.includes("apply_patch") ||
      eventLower.includes("workspace/editfile") ||
      eventLower.includes("code.insert") ||
      eventLower.includes(".insert");

    if (isChatTurn || isCodeAction) {
      const existing = ctx.chatSessionStates.get(rawSessionId) ?? {
        sessionId: rawSessionId,
        turnCount: 0,
        isAccepted: false,
      };
      if (isChatTurn) {
        existing.turnCount++;
      }
      if (isCodeAction) {
        existing.isAccepted = true;
      }
      ctx.chatSessionStates.set(rawSessionId, existing);
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
