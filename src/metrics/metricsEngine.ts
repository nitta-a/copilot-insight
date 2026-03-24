/**
 * Metrics Engine — Phase 2 of the roadmap.
 *
 * Computes advanced analytics from tracked events:
 *
 * 1. **True Acceptance Rate** — filters out completions whose accepted text
 *    was deleted or heavily modified within a configurable window (default:
 *    30 s), removing "hallucination waste" from the raw acceptance count.
 *
 * 2. **Velocity Analysis (KPM)** — calculates keystrokes-per-minute over
 *    sliding windows and correlates with completion acceptance timing to
 *    identify flow-disruption points.
 *
 * 3. **Model Performance Cross-tabulation** — aggregates acceptance rates
 *    by (model × language) to determine which model works best in each
 *    context (equivalent to an ASOF JOIN in DuckDB).
 */

import type { CompletionAcceptEvent, TrackedEvent } from "../events/eventSchema";
import type { MemoryManagementEvent, RefreshAnalysis, RefreshAnalysisSegment } from "../types";

// ---------------------------------------------------------------------------
// 1. True Acceptance Rate
// ---------------------------------------------------------------------------

/** Summary of the true-acceptance-rate analysis. */
export interface TrueAcceptanceResult {
  /** Total completions accepted (raw count). */
  rawAccepted: number;
  /** Completions still retained after the review window. */
  trueAccepted: number;
  /** Raw acceptance rate (rawAccepted / totalShown * 100). */
  rawRate: number;
  /** True acceptance rate (trueAccepted / totalShown * 100). */
  trueRate: number;
  /** Number of completions that were reverted/deleted. */
  revertedCount: number;
}

/**
 * Fraction of accepted characters that must be deleted to classify
 * the acceptance as "reverted".  A threshold of 0.5 means that if
 * ≥ 50 % of the accepted text length is deleted within the window,
 * the completion is considered a false/wasted acceptance.
 */
const REVERT_DELETION_THRESHOLD = 0.5;

/** Default window (ms) within which a deletion following an accept is considered a revert. */
const DEFAULT_REVERT_WINDOW_MS = 30_000;

/**
 * Calculate the "true" acceptance rate by checking whether accepted text was
 * deleted or heavily modified within `windowMs` milliseconds.
 *
 * Algorithm:
 * 1. Collect all `completionAccept` events.
 * 2. For each accept, look for `textChange` events in the same file/language
 *    within `windowMs` that delete more characters than 50 % of the accepted
 *    text length.  If found, the accept is classified as "reverted".
 * 3. `trueAccepted = rawAccepted − revertedCount`.
 */
export function computeTrueAcceptanceRate(
  events: TrackedEvent[],
  totalShown: number,
  windowMs: number = DEFAULT_REVERT_WINDOW_MS,
): TrueAcceptanceResult {
  const accepts = events.filter((e) => e.eventType === "completionAccept");

  // Pre-sort textChanges by timestamp and cache their ms values once.
  // Binary search then locates the start index for each accept in O(log C)
  // instead of scanning from the beginning on every iteration — O(A×C) → O(C log C + A log C).
  const rawTextChanges = events.filter((e) => e.eventType === "textChange");
  const textChangeTimes = rawTextChanges.map((c) => new Date(c.timestamp).getTime());
  // Sort both arrays together by timestamp.
  const changeOrder = Array.from({ length: rawTextChanges.length }, (_, i) => i).sort(
    (a, b) => textChangeTimes[a] - textChangeTimes[b],
  );
  const textChanges = changeOrder.map((i) => rawTextChanges[i]);
  const changeTimes = changeOrder.map((i) => textChangeTimes[i]);

  let revertedCount = 0;

  for (const accept of accepts) {
    if (accept.eventType !== "completionAccept") {
      continue;
    }
    const acceptTime = new Date(accept.timestamp).getTime();
    const threshold = accept.acceptedCharacters * REVERT_DELETION_THRESHOLD;

    // Binary search: find first index where changeTimes[i] >= acceptTime.
    let lo = 0;
    let hi = changeTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (changeTimes[mid] < acceptTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    let deletedInWindow = 0;
    for (let i = lo; i < textChanges.length; i++) {
      if (changeTimes[i] - acceptTime > windowMs) {
        break;
      }
      const change = textChanges[i];
      if (change.eventType === "textChange" && change.languageId === accept.languageId) {
        deletedInWindow += change.charsDeleted;
      }
    }

    if (deletedInWindow >= threshold && threshold > 0) {
      revertedCount++;
    }
  }

  const rawAccepted = accepts.length;
  const trueAccepted = rawAccepted - revertedCount;
  const rawRate = totalShown > 0 ? (rawAccepted / totalShown) * 100 : 0;
  const trueRate = totalShown > 0 ? (trueAccepted / totalShown) * 100 : 0;

  return { rawAccepted, trueAccepted, rawRate, trueRate, revertedCount };
}

function toSortedEvents(events: TrackedEvent[]): TrackedEvent[] {
  return [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function toSortedAccepts(events: TrackedEvent[]): CompletionAcceptEvent[] {
  return toSortedEvents(events).filter(
    (event): event is CompletionAcceptEvent => event.eventType === "completionAccept",
  );
}

/**
 * Build a RefreshAnalysisSegment from an already-sorted event slice.
 * Callers must pass a timestamp-sorted array; no internal re-sort is performed.
 */
function buildSegment(
  sortedEvents: TrackedEvent[],
  totalShown: number,
  revertWindowMs: number,
): RefreshAnalysisSegment {
  const result = computeTrueAcceptanceRate(sortedEvents, totalShown, revertWindowMs);
  return {
    turnCount: totalShown,
    rawAccepted: result.rawAccepted,
    trueAccepted: result.trueAccepted,
    rawRate: result.rawRate,
    trueRate: result.trueRate,
    revertedCount: result.revertedCount,
    windowStart: sortedEvents[0]?.timestamp ?? null,
    windowEnd: sortedEvents.at(-1)?.timestamp ?? null,
  };
}

function collectTurnWindowEvents(
  allEvents: TrackedEvent[],
  selectedAccepts: CompletionAcceptEvent[],
  revertWindowMs: number,
): TrackedEvent[] {
  if (selectedAccepts.length === 0) {
    return [];
  }
  const firstAcceptMs = new Date(selectedAccepts[0].timestamp).getTime();
  const lastAcceptMs = new Date(selectedAccepts.at(-1)?.timestamp ?? selectedAccepts[0].timestamp).getTime();
  const windowEndMs = lastAcceptMs + revertWindowMs;
  return allEvents.filter((event) => {
    const eventMs = new Date(event.timestamp).getTime();
    return eventMs >= firstAcceptMs && eventMs <= windowEndMs;
  });
}

export function computeRefreshAnalysis(
  events: TrackedEvent[],
  memoryEvents: MemoryManagementEvent[],
  options?: {
    windowMs?: number;
    turnWindowSize?: number;
    revertWindowMs?: number;
  },
): RefreshAnalysis[] {
  if (events.length === 0 || memoryEvents.length === 0) {
    return [];
  }

  const windowMs = options?.windowMs ?? 15 * 60_000;
  const turnWindowSize = options?.turnWindowSize ?? 10;
  const revertWindowMs = options?.revertWindowMs ?? DEFAULT_REVERT_WINDOW_MS;
  const sortedEvents = toSortedEvents(events);
  const accepts = toSortedAccepts(sortedEvents);

  return [...memoryEvents]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .flatMap((memoryEvent) => {
      const boundaryMs = new Date(memoryEvent.timestamp).getTime();
      if (Number.isNaN(boundaryMs)) {
        return [];
      }

      const preWindowEvents = sortedEvents.filter((event) => {
        const eventMs = new Date(event.timestamp).getTime();
        return eventMs >= boundaryMs - windowMs && eventMs < boundaryMs;
      });
      const postWindowEvents = sortedEvents.filter((event) => {
        const eventMs = new Date(event.timestamp).getTime();
        return eventMs > boundaryMs && eventMs <= boundaryMs + windowMs;
      });

      const preTurnAccepts = accepts
        .filter((event) => new Date(event.timestamp).getTime() < boundaryMs)
        .slice(-turnWindowSize);
      const postTurnAccepts = accepts
        .filter((event) => new Date(event.timestamp).getTime() > boundaryMs)
        .slice(0, turnWindowSize);

      const preTurnEvents = collectTurnWindowEvents(sortedEvents, preTurnAccepts, revertWindowMs);
      const postTurnEvents = collectTurnWindowEvents(sortedEvents, postTurnAccepts, revertWindowMs);

      const preWindow = buildSegment(
        preWindowEvents,
        preWindowEvents.filter((event) => event.eventType === "completionAccept").length,
        revertWindowMs,
      );
      const postWindow = buildSegment(
        postWindowEvents,
        postWindowEvents.filter((event) => event.eventType === "completionAccept").length,
        revertWindowMs,
      );
      const preTurns = buildSegment(preTurnEvents, preTurnAccepts.length, revertWindowMs);
      const postTurns = buildSegment(postTurnEvents, postTurnAccepts.length, revertWindowMs);

      if (
        preTurns.turnCount === 0 &&
        postTurns.turnCount === 0 &&
        preWindow.turnCount === 0 &&
        postWindow.turnCount === 0
      ) {
        return [];
      }

      return [
        {
          event: memoryEvent,
          windowMinutes: windowMs / 60_000,
          turnWindowSize,
          preWindow,
          postWindow,
          preTurns,
          postTurns,
          recoveryDelta: postTurns.trueRate - preTurns.trueRate,
          refreshRoi: preTurns.trueRate > 0 ? postTurns.trueRate / preTurns.trueRate - 1 : null,
        },
      ];
    });
}

// ---------------------------------------------------------------------------
// 2. Velocity Analysis (KPM — Keystrokes Per Minute)
// ---------------------------------------------------------------------------

/** A single KPM data point in the time series. */
export interface KpmDataPoint {
  /** ISO-8601 timestamp of the window start. */
  windowStart: string;
  /** Keystrokes per minute in this window. */
  kpm: number;
  /** Number of completions accepted in this window. */
  completionsAccepted: number;
  /** Whether the KPM dropped significantly around a completion event (flow disruption). */
  flowDisrupted: boolean;
}

/** Result of the velocity analysis. */
export interface VelocityAnalysisResult {
  /** KPM over sliding 1-minute windows. */
  timeSeries: KpmDataPoint[];
  /** Average KPM across all windows. */
  averageKpm: number;
  /** Number of windows where flow was disrupted by a completion. */
  disruptionCount: number;
}

/** Default sliding window size in milliseconds (1 minute). */
const KPM_WINDOW_MS = 60_000;

/**
 * KPM drop threshold: if KPM in the window containing a completion accept
 * is below `averageKpm * KPM_DISRUPTION_FACTOR`, it is flagged as a
 * flow disruption.  A factor of 0.6 means a 40 %+ drop from the session
 * average is considered disruptive — chosen based on empirical studies
 * showing that significant context-switching costs appear when typing
 * velocity drops below ~60 % of normal pace.
 */
const KPM_DISRUPTION_FACTOR = 0.6;

/**
 * Analyse typing velocity (KPM) over time and correlate with Copilot
 * suggestion acceptance events.
 *
 * @param events  Sorted array of tracked events.
 * @param windowMs  Sliding window size in ms (default: 60 000).
 */
export function computeVelocityAnalysis(
  events: TrackedEvent[],
  windowMs: number = KPM_WINDOW_MS,
): VelocityAnalysisResult {
  if (events.length === 0) {
    return { timeSeries: [], averageKpm: 0, disruptionCount: 0 };
  }

  // Pre-compute timestamps once and sort together with the event index.
  // This avoids calling new Date() inside the hot double loop — O(W×E) → O(E log E + E + W).
  const rawTimes = events.map((e) => new Date(e.timestamp).getTime());
  const order = Array.from({ length: events.length }, (_, i) => i).sort((a, b) => rawTimes[a] - rawTimes[b]);
  const sorted = order.map((i) => events[i]);
  const times = order.map((i) => rawTimes[i]);

  const minTime = times[0];
  const maxTime = times[times.length - 1];

  if (maxTime - minTime < windowMs) {
    let totalChars = 0;
    let completionsAccepted = 0;
    for (const e of sorted) {
      if (e.eventType === "textChange") {
        totalChars += e.charsAdded;
      } else if (e.eventType === "completionAccept") {
        completionsAccepted++;
      }
    }
    const minutes = Math.max((maxTime - minTime) / 60_000, 1);
    return {
      timeSeries: [
        {
          windowStart: new Date(minTime).toISOString(),
          kpm: totalChars / minutes,
          completionsAccepted,
          flowDisrupted: false,
        },
      ],
      averageKpm: totalChars / minutes,
      disruptionCount: 0,
    };
  }

  const series: KpmDataPoint[] = [];
  const minutesPerWindow = windowMs / 60_000;
  let lo = 0; // sliding left boundary index into sorted[]

  for (let windowStart = minTime; windowStart <= maxTime; windowStart += windowMs) {
    const windowEnd = windowStart + windowMs;
    // Advance lo past events that are before this window.
    while (lo < sorted.length && times[lo] < windowStart) {
      lo++;
    }
    let charsAdded = 0;
    let completionsInWindow = 0;
    for (let i = lo; i < sorted.length && times[i] < windowEnd; i++) {
      const e = sorted[i];
      if (e.eventType === "textChange") {
        charsAdded += e.charsAdded;
      } else if (e.eventType === "completionAccept") {
        completionsInWindow++;
      }
    }
    series.push({
      windowStart: new Date(windowStart).toISOString(),
      kpm: charsAdded / minutesPerWindow,
      completionsAccepted: completionsInWindow,
      flowDisrupted: false,
    });
  }

  const totalKpm = series.reduce((sum, dp) => sum + dp.kpm, 0);
  const averageKpm = series.length > 0 ? totalKpm / series.length : 0;

  let disruptionCount = 0;
  for (const dp of series) {
    if (dp.completionsAccepted > 0 && dp.kpm < averageKpm * KPM_DISRUPTION_FACTOR) {
      dp.flowDisrupted = true;
      disruptionCount++;
    }
  }

  return { timeSeries: series, averageKpm, disruptionCount };
}

// ---------------------------------------------------------------------------
// 3. Model Performance Cross-tabulation (ASOF JOIN equivalent)
// ---------------------------------------------------------------------------

/** Acceptance stats for a (model, language) pair. */
export interface ModelLanguageStat {
  modelName: string;
  languageId: string;
  totalAccepted: number;
  totalCharsAccepted: number;
  avgLatencyMs: number;
}

/** Result of the model-performance cross-tabulation. */
export interface ModelPerformanceResult {
  /** All (model × language) combinations with their stats. */
  crossTab: ModelLanguageStat[];
  /** Best model for each language (highest accepted count). */
  bestModelByLanguage: Map<string, string>;
}

/**
 * Cross-tabulate completion-accept events by model and language to determine
 * which model produces the highest acceptance rates in each context.
 *
 * This is the TypeScript equivalent of a DuckDB ASOF JOIN that correlates
 * model metadata with per-file/language acceptance statistics.
 */
export function computeModelPerformance(events: TrackedEvent[]): ModelPerformanceResult {
  const accepts = events.filter((e) => e.eventType === "completionAccept");

  const map = new Map<string, { total: number; chars: number; latencySum: number }>();

  for (const e of accepts) {
    if (e.eventType !== "completionAccept") {
      continue;
    }
    const key = `${e.modelName || "unknown"}|${e.languageId || "unknown"}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { total: 1, chars: e.acceptedCharacters, latencySum: e.latencyMs });
    } else {
      existing.total++;
      existing.chars += e.acceptedCharacters;
      existing.latencySum += e.latencyMs;
    }
  }

  const crossTab: ModelLanguageStat[] = [];
  for (const [key, stats] of map) {
    const [modelName, languageId] = key.split("|");
    crossTab.push({
      modelName,
      languageId,
      totalAccepted: stats.total,
      totalCharsAccepted: stats.chars,
      avgLatencyMs: stats.total > 0 ? stats.latencySum / stats.total : 0,
    });
  }

  crossTab.sort((a, b) => b.totalAccepted - a.totalAccepted);

  const bestModelByLanguage = new Map<string, string>();
  const byLang = new Map<string, ModelLanguageStat[]>();
  for (const entry of crossTab) {
    const existing = byLang.get(entry.languageId) ?? [];
    existing.push(entry);
    byLang.set(entry.languageId, existing);
  }
  for (const [lang, entries] of byLang) {
    entries.sort((a, b) => b.totalAccepted - a.totalAccepted);
    if (entries[0]) {
      bestModelByLanguage.set(lang, entries[0].modelName);
    }
  }

  return { crossTab, bestModelByLanguage };
}
