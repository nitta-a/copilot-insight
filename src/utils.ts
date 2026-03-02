/** Returns the current date formatted as YYYY-MM-DD. */
export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
