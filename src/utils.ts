/** Returns the current date formatted as YYYY-MM-DD. */
export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Formats a duration in minutes into a human-readable string.
 * Examples: 0 → "0m", 45 → "45m", 90 → "1h 30m", 120 → "2h"
 */
export function formatMinutesSaved(minutes: number): string {
  if (minutes < 1) {
    return "0m";
  }
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  if (h === 0) {
    return `${m}m`;
  }
  if (m === 0) {
    return `${h}h`;
  }
  return `${h}h ${m}m`;
}

/** Average characters per accepted completion (used for ROI estimation). */
const AVG_CHARS_PER_COMPLETION = 40;
/** Estimated developer typing speed in chars/min (used for ROI estimation). */
const TYPING_SPEED_CPM = 200;
/** Cognitive weight for agentic time saved (50% credit). */
const AGENTIC_COGNITIVE_WEIGHT = 0.5;

/**
 * Calculates total estimated minutes saved from both inline completions and
 * agentic autonomous duration.
 */
export function calculateTimeSavedMinutes(totalAccepted: number, autonomousDurationMs: number): number {
  const typingMinutes = (totalAccepted * AVG_CHARS_PER_COMPLETION) / TYPING_SPEED_CPM;
  const agenticMinutes = (autonomousDurationMs / 60000) * AGENTIC_COGNITIVE_WEIGHT;
  return typingMinutes + agenticMinutes;
}

/** ROI tier with associated badge emoji and CSS colour identifier. */
export type RoiTier = "gold" | "green" | "blue" | null;

/** ROI thresholds in minutes. */
const ROI_TIER_GOLD = 600;
const ROI_TIER_GREEN = 180;
const ROI_TIER_BLUE = 60;

/** Badge emoji for each ROI tier (null = no badge). */
const ROI_BADGES: Record<Exclude<RoiTier, null>, string> = {
  gold: "🏆 ",
  green: "⭐ ",
  blue: "✨ ",
};

/**
 * Returns the ROI tier for the given number of minutes saved.
 * - gold  (🏆): 600+ minutes (10 h)
 * - green (⭐): 180+ minutes  (3 h)
 * - blue  (✨):  60+ minutes  (1 h)
 * - null:        below threshold
 */
export function getRoiTier(totalMinutesSaved: number): RoiTier {
  if (totalMinutesSaved >= ROI_TIER_GOLD) {
    return "gold";
  }
  if (totalMinutesSaved >= ROI_TIER_GREEN) {
    return "green";
  }
  if (totalMinutesSaved >= ROI_TIER_BLUE) {
    return "blue";
  }
  return null;
}

/** Returns the badge emoji for the given ROI tier (empty string when no tier). */
export function getRoiBadge(tier: RoiTier): string {
  return tier ? ROI_BADGES[tier] : "";
}
