import type { CliInterventions, PermissionRecord } from "../types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

function label(value: unknown): string | null {
  const result = text(value);
  return result && /^[\w.:-]+$/.test(result) ? result : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

export function parseInterventions(content: string, seen = new Set<string>()): CliInterventions {
  const permissions = new Map<string, PermissionRecord>();
  const tools = new Map<string, string>();
  const steering: string[] = [];
  const stops: string[] = [];
  let sequence = 0;
  for (const line of content.split("\n")) {
    sequence++;
    let event: Record<string, unknown>;
    try {
      event = record(JSON.parse(line));
    } catch {
      continue;
    }
    const data = record(event.data);
    const type = text(event.type);
    const id = text(event.id);
    if (id && seen.has(id)) {
      continue;
    }
    if (id) {
      seen.add(id);
    }
    const at = timestamp(event.timestamp);
    if (type === "tool.execution_start" || type === "tool.execution_complete") {
      const callId = text(data.toolCallId);
      const name = label(data.toolName);
      if (callId && name) {
        tools.set(callId, name);
      }
    } else if (type === "user.message" && data.delivery === "steering") {
      if (at) {
        steering.push(at);
      }
    } else if (type === "abort" && data.reason === "user_initiated") {
      if (at) {
        stops.push(at);
      }
    } else if (type === "permission.requested" || type === "permission.completed") {
      const requestId = text(data.requestId) ?? `missing:${id ?? sequence}`;
      const entry = permissions.get(requestId) ?? {
        requestId,
        kind: null,
        toolCallId: null,
        toolName: null,
        requestedAt: null,
        respondedAt: null,
        decisionSource: null,
        result: null,
        requestRecorded: false,
        responseRecorded: false,
      };
      if (type === "permission.requested" && !entry.requestRecorded) {
        const request = record(data.permissionRequest);
        entry.requestRecorded = true;
        entry.requestedAt = at;
        entry.kind = label(request.kind);
        entry.toolCallId = text(request.toolCallId);
        entry.toolName = label(request.toolName);
      } else if (type === "permission.completed" && !entry.responseRecorded) {
        entry.responseRecorded = true;
        entry.respondedAt = at;
        entry.toolCallId ??= text(data.toolCallId);
        entry.decisionSource =
          data.decisionSource === "human_response" || data.decisionSource === "host_policy"
            ? data.decisionSource
            : null;
        const kind = record(data.result).kind;
        entry.result = kind === "approved" || kind === "cancelled" ? kind : null;
      }
      permissions.set(requestId, entry);
    }
  }
  for (const entry of permissions.values()) {
    entry.toolName ??= entry.toolCallId ? (tools.get(entry.toolCallId) ?? null) : null;
  }
  return { permissions: [...permissions.values()], steering, stops };
}

export function elapsedMs(entry: PermissionRecord): number | null {
  if (!entry.requestedAt || !entry.respondedAt) {
    return null;
  }
  const elapsed = Date.parse(entry.respondedAt) - Date.parse(entry.requestedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

export function summarizeInterventions(
  threads: Array<{ interventions?: CliInterventions }>,
  start: string | null,
  end: string | null,
) {
  const inRange = (at: string | null) =>
    !!at && (!start || at.slice(0, 10) >= start) && (!end || at.slice(0, 10) <= end);
  const counts = new Map<string, number>();
  const durations: number[] = [];
  let human = 0,
    hostPolicy = 0,
    observedSessions = 0,
    humanSessions = 0,
    steering = 0,
    stops = 0;
  for (const thread of threads) {
    const data = thread.interventions;
    if (!data) {
      continue;
    }
    const observed = data.permissions.filter((p) => inRange(p.requestedAt) || inRange(p.respondedAt));
    if (observed.length) {
      observedSessions++;
    }
    const responses = data.permissions.filter(
      (p) => p.responseRecorded && p.decisionSource === "human_response" && inRange(p.respondedAt),
    );
    if (responses.length) {
      humanSessions++;
    }
    human += responses.length;
    hostPolicy += data.permissions.filter(
      (p) => p.responseRecorded && p.decisionSource === "host_policy" && inRange(p.respondedAt),
    ).length;
    for (const p of responses) {
      counts.set(p.kind ?? "Unknown", (counts.get(p.kind ?? "Unknown") ?? 0) + 1);
      const duration = elapsedMs(p);
      if (duration !== null) {
        durations.push(duration);
      }
    }
    steering += data.steering.filter(inRange).length;
    stops += data.stops.filter(inRange).length;
  }
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length ? (durations[middle] + durations[Math.floor((durations.length - 1) / 2)]) / 2 : null;
  return {
    human,
    hostPolicy,
    observedSessions,
    humanSessions,
    counts: [...counts],
    median,
    samples: durations.length,
    steering,
    stops,
  };
}
