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
