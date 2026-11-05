export function recordedPeriod(period: string, dates: Array<string | null | undefined>) {
  const end =
    dates
      .filter((date): date is string => !!date)
      .sort()
      .at(-1) ?? null;
  if (period === "all") {
    return { start: null, end: null };
  }
  const start = end
    ? new Date(Date.parse(`${end}T00:00:00Z`) - (Number(period) - 1) * 86_400_000).toISOString().slice(0, 10)
    : "9999-99-99";
  return { start, end };
}
