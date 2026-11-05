import * as assert from "node:assert/strict";
import { formatProjectShare, projectChartRows, projectPeriodRange, projectsForPeriod } from "../../webview/utils/projectUsage";

suite("project usage periods", () => {
  test("uses the same inclusive UTC date boundaries for display and filtering", () => {
    const now = new Date("2026-03-02T00:01:00Z");
    assert.deepEqual(projectPeriodRange("7", now), { start: "2026-02-24", end: "2026-03-02" });
    assert.deepEqual(projectPeriodRange("14", now), { start: "2026-02-17", end: "2026-03-02" });
    assert.deepEqual(projectPeriodRange("30", now), { start: "2026-02-01", end: "2026-03-02" });
    assert.deepEqual(projectPeriodRange("month", now), { start: "2026-03-01", end: "2026-03-02" });
    assert.deepEqual(projectPeriodRange("week", now), { start: "2026-03-02", end: "2026-03-02" });
    assert.deepEqual(projectPeriodRange("week", new Date("2026-03-01T23:59:00Z")), { start: "2026-02-23", end: "2026-03-01" });
    assert.deepEqual(projectPeriodRange("lastWeek", now), { start: "2026-02-23", end: "2026-03-01" });
    assert.deepEqual(projectPeriodRange("lastWeek", new Date("2026-03-01T23:59:00Z")), { start: "2026-02-16", end: "2026-02-22" });
    assert.equal(projectPeriodRange("all", now), null);
  });
  test("shows shares relative to the total, including zero and unknown cases", () => {
    assert.equal(formatProjectShare(25, 100), "25%");
    assert.equal(formatProjectShare(100, 100), "100%");
    assert.equal(formatProjectShare(0, 100), "0%");
    assert.equal(formatProjectShare(1, 1_000_000), "<0.01%");
    assert.equal(formatProjectShare(0, 0), "Unavailable");
    assert.equal(formatProjectShare(1, null), "Unavailable");
    assert.equal(formatProjectShare(null, 10), "Unavailable");
  });
  test("builds overall and distinct project bars without treating unavailable credits as zero", () => {
    const project = { name: "a", path: "/one/a", inputTokens: 20, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 1, aiCredits: 2, dailyUsage: [] };
    const rows = projectChartRows([project, { ...project, path: "/two/a", inputTokens: 10, aiCredits: null }]);
    assert.deepEqual(rows.map((row) => [row.label, row.path]), [["All projects", null], ["1. a", "/one/a"], ["2. a", "/two/a"]]);
    assert.equal(rows[0].inputTokens, 30);
    assert.equal(rows[0].outputTokens, 6);
    assert.equal(rows[0].aiCredits, null);
    assert.equal(projectChartRows([project])[0].aiCredits, 2);
  });
  test("selects inclusive UTC calendar dates and preserves unavailable credits", () => {
    const dailyUsage = ["2026-10-31", "2026-11-01", "2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"].map((date, index) => ({
      date,
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1, reasoningTokens: 0, totalNanoAiu: index === 2 ? null : 1_000_000_000 },
    }));
    const project = { path: "/work/a", name: "a", inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, aiCredits: 5, dailyUsage };
    const now = new Date("2026-11-14T23:00:00Z");
    assert.equal(projectsForPeriod([project], "all", now)[0].inputTokens, 100);
    assert.equal(projectsForPeriod([project], "7", now)[0].inputTokens, 20);
    assert.equal(projectsForPeriod([project], "7", now)[0].aiCredits, 2);
    assert.equal(projectsForPeriod([project], "14", now)[0].inputTokens, 40);
    assert.equal(projectsForPeriod([project], "14", now)[0].aiCredits, null);
    assert.equal(projectsForPeriod([project], "month", now)[0].inputTokens, 40);
    assert.equal(projectsForPeriod([project], "week", now)[0].inputTokens, 10);
    assert.equal(projectsForPeriod([project], "lastWeek", now)[0].inputTokens, 20);
    assert.equal(projectsForPeriod([project], "30", now)[0].cacheReadTokens, 15);
    assert.deepEqual(projectsForPeriod([project], "7", new Date("2027-01-01T00:00:00Z")), []);
  });
});
