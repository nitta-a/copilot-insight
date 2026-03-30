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
  normalizeModelName,
  normalizeTimestamp,
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
  const rawModelValue = data.model ?? data.modelId ?? data.engineId ?? data.engineName ?? data.engine;
  const jsonModel = typeof rawModelValue === "string" ? normalizeModelName(rawModelValue) : "";
  if (jsonModel) {
    if (isShown) {
      incrementStatCount(ctx.byModel, jsonModel, "shown");
    } else if (isAccepted) {
      incrementStatCount(ctx.byModel, jsonModel, "accepted");
    } else if (!eventLower.includes("rejected") && !eventLower.includes("dismissed")) {
      incrementCount(ctx.byChatModel, jsonModel);
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
  // Pass the extracted model name so that plan-proposal signals are tagged
  // with the model that generated them (enables topPlanModel KPI).
  trackPlanningStats(eventLower, ctx, timestamp, event, jsonModel);

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

  // ── Token Consumption Tracking ────────────────────────────────────────────
  // Extract prompt and completion token counts from any JSON log entry that
  // carries token-usage fields. Copilot log entries use several field-name
  // conventions depending on the log source and version:
  //   - `promptTokens` / `prompt_tokens` / `numPromptTokens` / `numTokens`
  //   - `completionTokens` / `completion_tokens` / `numCompletionTokens`
  //   - `totalTokens` / `total_tokens` (treated as completion tokens when no
  //     explicit split is present)
  const rawPromptTokens =
    data.promptTokens ?? data.prompt_tokens ?? data.numPromptTokens ?? data.numTokens ?? data.tokenCount;
  const rawCompletionTokens = data.completionTokens ?? data.completion_tokens ?? data.numCompletionTokens;
  const rawTotalTokens = data.totalTokens ?? data.total_tokens;

  const promptTokenCount = typeof rawPromptTokens === "number" && rawPromptTokens > 0 ? Math.round(rawPromptTokens) : 0;

  let completionTokenCount = 0;
  if (typeof rawCompletionTokens === "number" && rawCompletionTokens > 0) {
    completionTokenCount = Math.round(rawCompletionTokens);
  } else if (promptTokenCount === 0 && typeof rawTotalTokens === "number" && rawTotalTokens > 0) {
    // Only use totalTokens as a fallback when no per-role split is present,
    // to avoid double-counting when both promptTokens and totalTokens are logged.
    completionTokenCount = Math.round(rawTotalTokens);
  }

  if (promptTokenCount > 0 || completionTokenCount > 0) {
    ctx.totalPromptTokens += promptTokenCount;
    ctx.totalCompletionTokens += completionTokenCount;

    if (jsonModel) {
      const existing = ctx.tokensByModel.get(jsonModel) ?? { promptTokens: 0, completionTokens: 0 };
      existing.promptTokens += promptTokenCount;
      existing.completionTokens += completionTokenCount;
      ctx.tokensByModel.set(jsonModel, existing);
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
