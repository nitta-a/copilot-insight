import type { FusionRun, FusionUsage } from "../types";

const fields = [
  "requestCount",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "totalNanoAiu",
] as const;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const usage = (value: unknown): FusionUsage => {
  const data = record(value);
  return Object.fromEntries(fields.map((key) => [key, num(data[key])])) as unknown as FusionUsage;
};

/** Extract only accounting metadata; never retain event content or prompts. */
export function parseFusion(content: string): FusionRun[] {
  const runs = new Map<string, FusionRun>();
  for (const line of content.split("\n")) {
    let event: Record<string, unknown>;
    try {
      event = record(JSON.parse(line));
    } catch {
      continue;
    }
    const type = event.type;
    if (
      type !== "session.fusion_resolved" &&
      type !== "assistant.fusion_phase_completed" &&
      type !== "session.fusion_completed" &&
      type !== "session.fusion_handoff"
    ) {
      continue;
    }
    const data = record(event.data);
    const id = str(data.fusionId);
    if (!id) {
      continue;
    }
    let run = runs.get(id);
    if (!run) {
      run = { fusionId: id, timestamp: null, mode: null, pattern: null, plan: [], phases: [], completed: null };
      runs.set(id, run);
    }
    const timestamp = str(event.timestamp);
    if (
      timestamp &&
      !Number.isNaN(Date.parse(timestamp)) &&
      (!run.timestamp || Date.parse(timestamp) < Date.parse(run.timestamp))
    ) {
      run.timestamp = timestamp;
    }
    if (type === "session.fusion_resolved") {
      run.mode = str(data.syntheticModel);
      run.pattern = str(data.pattern);
      run.plan = Array.isArray(data.phasePlan)
        ? data.phasePlan.map((item: unknown) => {
            const p = record(item);
            return {
              kind: str(p.kind),
              role: str(p.role),
              scope: str(p.scope),
              conditional: typeof p.conditional === "boolean" ? p.conditional : null,
            };
          })
        : [];
    } else if (type === "assistant.fusion_phase_completed") {
      const phaseId = str(data.phaseId) ?? str(event.id);
      if (!phaseId || run.phases.some((phase) => phase.phaseId === phaseId)) {
        continue;
      }
      run.phases.push({
        phaseId,
        kind: str(data.phaseKind),
        role: str(data.role),
        scope: str(data.conversationScope),
        model: str(data.model),
        status: str(data.status),
        verdict: str(data.verdict),
        durationMs: num(data.durationMs),
        usage: usage(data.usage),
        reasoningEffort: str(data.reasoningEffort),
      });
    } else if (type === "session.fusion_completed") {
      run.mode ??= str(data.syntheticModel);
      run.pattern ??= str(data.pattern);
      run.completed = {
        finalModel: str(data.finalSourceModel),
        finalPhaseId: str(data.finalSourcePhaseId),
        durationMs: num(data.durationMs),
        outcome: str(data.outcome),
        usage: usage(data),
      };
    }
  }
  return [...runs.values()];
}

export function fusionReconciliation(run: FusionRun): "match" | "mismatch" | "unavailable" {
  if (!run.completed || !run.phases.length) {
    return "unavailable";
  }
  let missing = false;
  for (const key of fields) {
    const values = run.phases.map((phase) => phase.usage[key]);
    const total = run.completed.usage[key];
    if (total === null || values.some((value) => value === null)) {
      missing = true;
      continue;
    }
    if (values.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== total) {
      return "mismatch";
    }
  }
  return missing ? "unavailable" : "match";
}

export function summarizeFusion(runs: FusionRun[], start: string | null, end: string | null) {
  const visible = runs.filter((run) => {
    if (!run.timestamp) {
      return false;
    }
    const date = new Date(run.timestamp).toISOString().slice(0, 10);
    return (!start || date >= start) && (!end || date <= end);
  });
  const paths = new Map<string, number>();
  const roles = new Map<string, number | null>();
  let judged = 0;
  let repaired = 0;
  for (const run of visible) {
    const path = run.phases.map((phase) => phase.kind ?? "unknown").join(" → ") || "No phases observed";
    paths.set(path, (paths.get(path) ?? 0) + 1);
    if (run.phases.some((phase) => phase.kind === "judge")) {
      judged++;
      if (run.phases.some((phase) => phase.kind === "repair")) {
        repaired++;
      }
    }
    for (const phase of run.phases) {
      const role = phase.kind ?? "unknown";
      const previous = roles.get(role) ?? (roles.has(role) ? null : 0);
      roles.set(
        role,
        previous === null || phase.usage.totalNanoAiu === null ? null : previous + phase.usage.totalNanoAiu,
      );
    }
  }
  return { paths: [...paths], roles: [...roles], judged, repaired, count: visible.length };
}
