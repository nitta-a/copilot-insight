import type { CliDiagnostics } from "../types";

export function summarizeModelCalls(calls: CliDiagnostics["modelCalls"]) {
  const models = new Map<string, { durations: number[]; firstTokens: number[] }>();
  for (const call of calls) {
    const entry = models.get(call.model) ?? { durations: [], firstTokens: [] };
    if (call.durationMs !== null) {
      entry.durations.push(call.durationMs);
    }
    if (call.firstTokenMs !== null) {
      entry.firstTokens.push(call.firstTokenMs);
    }
    models.set(call.model, entry);
  }
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  return [...models]
    .map(([model, entry]) => ({
      model,
      duration: average(entry.durations),
      durationSamples: entry.durations.length,
      firstToken: average(entry.firstTokens),
      firstTokenSamples: entry.firstTokens.length,
    }))
    .sort((a, b) => b.durationSamples - a.durationSamples || a.model.localeCompare(b.model));
}
