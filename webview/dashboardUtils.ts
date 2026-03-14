/**
 * Dashboard utility helpers — pure formatting and escaping functions shared
 * between the main dashboard orchestrator and HTML builder modules.
 */

import type { AgentStep } from "../src/types";

/** Escape characters that are unsafe inside HTML text / attribute values. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Truncate a string to `max` characters, appending "…" when truncated. */
export function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Format a YYYY-MM-DD date string as MM/DD (UTC). */
export function fmtDate(dateStr: string): string {
  try {
    // Append 'T00:00:00Z' to force UTC parsing so the display date is
    // timezone-independent (YYYY-MM-DD strings represent whole days).
    const d = new Date(`${dateStr}T00:00:00Z`);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  } catch {
    return dateStr;
  }
}

/** Format a millisecond duration as a human-readable "Xm Ys" or "Xs" string. */
export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** Format a millisecond pause as a human-readable string. */
export function formatPause(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Capitalise the first letter of a session phase label. */
export function formatPhaseLabel(phase: string): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/** Coerce an unknown step detail to a display string. */
export function formatStepDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (detail === null || detail === undefined) {
    return fallback;
  }
  if (typeof detail === "object") {
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return fallback;
    }
  }
  return String(detail);
}

/** Return the CSS modifier class for an agent step label badge. */
export function agentStepBadgeClass(label: AgentStep["label"]): string {
  switch (label) {
    case "Prompt":
      return "prompt";
    case "Updated":
      return "updated";
    case "Executed":
      return "executed";
    case "Searched":
      return "searched";
    case "Reviewed":
      return "reviewed";
    case "Evaluating":
      return "evaluating";
    case "Considered":
      return "considered";
    case "Creating":
      return "creating";
    case "Used reference":
      return "reference";
    case "Memory file":
      return "memory";
    case "Thought":
      return "thought";
    case "Activity":
      return "activity";
  }
}

/** Return the CSS modifier class for an actor badge. */
export function actorBadgeClass(actor: AgentStep["actor"]): string {
  switch (actor) {
    case "human":
      return "human";
    case "ai":
      return "ai";
    case "system":
      return "system";
  }
}

/** Return the display label for an actor. */
export function actorLabel(actor: AgentStep["actor"]): string {
  switch (actor) {
    case "human":
      return "Human";
    case "ai":
      return "AI";
    case "system":
      return "System";
  }
}

/** Return the emoji icon for an actor. */
export function actorIcon(actor: AgentStep["actor"]): string {
  switch (actor) {
    case "human":
      return "👤";
    case "ai":
      return "🤖";
    case "system":
      return "⚙";
  }
}

/** Format a signed ratio as a percentage string with sign prefix. */
export function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  const signed = value >= 0 ? "+" : "";
  return `${signed}${(value * 100).toFixed(1)}%`;
}

/** Format a signed point value as a string with sign prefix. */
export function formatSignedPoints(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  const signed = value >= 0 ? "+" : "";
  return `${signed}${value.toFixed(1)} pt`;
}

/** Return the CSS class for a positive/negative/neutral delta value. */
export function getDeltaClass(value: number | null): string {
  if (value === null) {
    return "db-refresh-roi-neutral";
  }
  if (value > 0) {
    return "db-refresh-roi-positive";
  }
  if (value < 0) {
    return "db-refresh-roi-negative";
  }
  return "db-refresh-roi-neutral";
}

/** Return the CSS modifier class for an insight card based on its text content. */
export function getInsightClass(text: string): string {
  if (/📈/.test(text)) {
    return " positive";
  }
  if (/📉/.test(text)) {
    return " negative";
  }
  return "";
}
