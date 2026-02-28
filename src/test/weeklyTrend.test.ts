import * as assert from "assert";
import type { DateStat } from "../types";
import { calculateWeeklyTrend } from "../weeklyTrend";

/** Helper: format a Date to YYYY-MM-DD. */
function fmt(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Helper: get a date offset from today. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** Helper: get Monday of the week containing the given date. */
function getMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

suite("weeklyTrend", () => {
  suite("calculateWeeklyTrend", () => {
    test("returns zeroed stats when both maps are empty", () => {
      const result = calculateWeeklyTrend(new Map(), new Map());
      assert.strictEqual(result.thisWeek.shown, 0);
      assert.strictEqual(result.thisWeek.accepted, 0);
      assert.strictEqual(result.thisWeek.chat, 0);
      assert.strictEqual(result.thisWeek.rate, 0);
      assert.strictEqual(result.lastWeek.shown, 0);
      assert.strictEqual(result.lastWeek.accepted, 0);
      assert.strictEqual(result.lastWeek.chat, 0);
      assert.strictEqual(result.lastWeek.rate, 0);
      assert.strictEqual(result.rateDiff, 0);
    });

    test("aggregates this week data correctly", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = fmt(today);

      const byDate = new Map<string, DateStat>();
      byDate.set(todayStr, { shown: 10, accepted: 7 });

      const chatByDate = new Map<string, number>();
      chatByDate.set(todayStr, 3);

      const result = calculateWeeklyTrend(byDate, chatByDate);
      assert.strictEqual(result.thisWeek.shown, 10);
      assert.strictEqual(result.thisWeek.accepted, 7);
      assert.strictEqual(result.thisWeek.chat, 3);
      assert.strictEqual(result.thisWeek.rate, 70);
    });

    test("aggregates last week data correctly", () => {
      // Get a day that was definitely last week
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thisMonday = getMonday(today);
      const lastWednesday = new Date(thisMonday);
      lastWednesday.setDate(thisMonday.getDate() - 5); // Wed of last week

      const byDate = new Map<string, DateStat>();
      byDate.set(fmt(lastWednesday), { shown: 20, accepted: 15 });

      const chatByDate = new Map<string, number>();
      chatByDate.set(fmt(lastWednesday), 5);

      const result = calculateWeeklyTrend(byDate, chatByDate);
      assert.strictEqual(result.lastWeek.shown, 20);
      assert.strictEqual(result.lastWeek.accepted, 15);
      assert.strictEqual(result.lastWeek.chat, 5);
      assert.strictEqual(result.lastWeek.rate, 75);
      // This week should be empty
      assert.strictEqual(result.thisWeek.shown, 0);
    });

    test("calculates positive rateDiff when this week improved", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thisMonday = getMonday(today);
      const lastWednesday = new Date(thisMonday);
      lastWednesday.setDate(thisMonday.getDate() - 5);

      const byDate = new Map<string, DateStat>();
      byDate.set(fmt(lastWednesday), { shown: 100, accepted: 50 }); // 50%
      byDate.set(fmt(today), { shown: 100, accepted: 80 }); // 80%

      const result = calculateWeeklyTrend(byDate, new Map());
      assert.ok(result.rateDiff > 0, `rateDiff should be positive but was ${result.rateDiff}`);
      assert.strictEqual(result.rateDiff, 30); // 80 - 50
    });

    test("calculates negative rateDiff when this week regressed", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thisMonday = getMonday(today);
      const lastWednesday = new Date(thisMonday);
      lastWednesday.setDate(thisMonday.getDate() - 5);

      const byDate = new Map<string, DateStat>();
      byDate.set(fmt(lastWednesday), { shown: 100, accepted: 80 }); // 80%
      byDate.set(fmt(today), { shown: 100, accepted: 50 }); // 50%

      const result = calculateWeeklyTrend(byDate, new Map());
      assert.ok(result.rateDiff < 0, `rateDiff should be negative but was ${result.rateDiff}`);
      assert.strictEqual(result.rateDiff, -30);
    });

    test("rateDiff is 0 when only one week has data", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const byDate = new Map<string, DateStat>();
      byDate.set(fmt(today), { shown: 100, accepted: 70 });

      const result = calculateWeeklyTrend(byDate, new Map());
      assert.strictEqual(result.rateDiff, 0);
    });

    test("aggregates multiple days within same week", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = daysAgo(1);

      // Both should be in the same week if today is not Monday,
      // otherwise yesterday is last week. Handle both cases.
      const thisMonday = getMonday(today);
      const byDate = new Map<string, DateStat>();

      // Add data for Monday of this week and today
      byDate.set(fmt(thisMonday), { shown: 10, accepted: 5 });
      byDate.set(fmt(today), { shown: 20, accepted: 15 });

      const chatByDate = new Map<string, number>();
      chatByDate.set(fmt(thisMonday), 2);
      chatByDate.set(fmt(today), 3);

      const result = calculateWeeklyTrend(byDate, chatByDate);

      // If today is Monday, thisMonday === today, so only one entry
      if (fmt(thisMonday) === fmt(today)) {
        assert.strictEqual(result.thisWeek.shown, 20); // last set wins for same key
        assert.strictEqual(result.thisWeek.chat, 3);
      } else {
        assert.strictEqual(result.thisWeek.shown, 30);
        assert.strictEqual(result.thisWeek.accepted, 20);
        assert.strictEqual(result.thisWeek.chat, 5);
      }
    });

    test("ignores dates older than last week", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const twoWeeksAgo = daysAgo(14);

      const byDate = new Map<string, DateStat>();
      byDate.set(fmt(twoWeeksAgo), { shown: 100, accepted: 50 });
      byDate.set(fmt(today), { shown: 10, accepted: 8 });

      const result = calculateWeeklyTrend(byDate, new Map());
      // Two weeks ago data should not appear in either week
      assert.strictEqual(result.lastWeek.shown, 0);
      assert.strictEqual(result.thisWeek.shown, 10);
    });
  });
});
