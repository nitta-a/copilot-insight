/**
 * Metrics Engine — Phase 2 of the roadmap.
 *
 * Computes advanced analytics from tracked events:
 *
 * 2. **Velocity Analysis (KPM)** — calculates keystrokes-per-minute over
 *    sliding windows and correlates with completion acceptance timing to
 *    identify flow-disruption points.
 *
 * 3. **Model Performance Cross-tabulation** — aggregates acceptance rates
 *    by (model × language) to determine which model works best in each
 *    context (equivalent to an ASOF JOIN in DuckDB).
 */

import type { TrackedEvent } from "../events/eventSchema";

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
