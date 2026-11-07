/** Returns the current date formatted as YYYY-MM-DD. */
export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toAiCredits(nanoAiu: number | null): number | null {
  return nanoAiu === null ? null : nanoAiu / 1e9;
}
