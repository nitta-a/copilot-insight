import * as assert from "assert";
import { CopilotUsageTreeProvider } from "../copilotUsageTreeProvider";
import type { CopilotUsageStats } from "../types";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 100,
    totalAccepted: 70,
    totalRejected: 30,
    totalChat: 15,
    acceptanceRate: 70.0,
    avgLatencyMs: 250,
    byLanguage: new Map([
      ["typescript", { shown: 60, accepted: 45 }],
      ["python", { shown: 40, accepted: 25 }],
    ]),
    byDate: new Map([
      ["2026-02-25", { shown: 30, accepted: 20 }],
      ["2026-02-26", { shown: 35, accepted: 25 }],
      ["2026-02-27", { shown: 20, accepted: 15 }],
      ["2026-02-28", { shown: 15, accepted: 10 }],
    ]),
    byModel: new Map([["gpt-4", { shown: 80, accepted: 60 }]]),
    byChatModel: new Map([["gpt-4o", 15]]),
    byHour: new Map([["10", 30]]),
    byChatIntent: new Map([["Agent", 10]]),
    logFilesFound: 5,
    chatByDate: new Map([
      ["2026-02-27", 7],
      ["2026-02-28", 8],
    ]),
    chatByHour: new Map([["10", 5]]),
    totalErrors: 0,
    errorsByType: new Map(),
    latencies: [100, 200, 300],
    chatLatencies: [150, 250],
    latencyP50: 200,
    latencyP95: 300,
    latencyP99: 300,
    chatAvgLatencyMs: 200,
    chatLatencyP50: 150,
    chatLatencyP95: 250,
    bySession: new Map([
      ["session-1", { sessionId: "session-1", shown: 60, accepted: 40, chat: 10, errors: 0 }],
    ]),
    ...overrides,
  };
}

suite("CopilotUsageTreeProvider", () => {
  suite("initial state", () => {
    test("returns empty children when no stats loaded", () => {
      const provider = new CopilotUsageTreeProvider();
      const children = provider.getChildren();
      assert.strictEqual(children.length, 0);
    });

    test("hasData is false initially", () => {
      const provider = new CopilotUsageTreeProvider();
      assert.strictEqual(provider.hasData, false);
    });
  });

  suite("updateStats", () => {
    test("hasData becomes true after updateStats", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      assert.strictEqual(provider.hasData, true);
    });

    test("fires onDidChangeTreeData event", () => {
      const provider = new CopilotUsageTreeProvider();
      let fired = false;
      provider.onDidChangeTreeData(() => {
        fired = true;
      });
      provider.updateStats(makeStats());
      assert.strictEqual(fired, true);
    });
  });

  suite("getChildren (root)", () => {
    test("returns 4 category nodes when no errors", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ totalErrors: 0 }));
      const roots = provider.getChildren();
      assert.strictEqual(roots.length, 4);
    });

    test("returns 5 category nodes when errors exist", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ totalErrors: 3, errorsByType: new Map([["HTTP 500", 3]]) }));
      const roots = provider.getChildren();
      assert.strictEqual(roots.length, 5);
    });

    test("root labels are correct", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const labels = roots.map((r) => (typeof r.label === "string" ? r.label : ""));
      assert.ok(labels.includes("Summary"));
      assert.ok(labels.includes("Weekly Trend"));
      assert.ok(labels.includes("By Language"));
      assert.ok(labels.includes("Daily (7 days)"));
    });
  });

  suite("getChildren (summary category)", () => {
    test("summary has at least 5 items", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const summary = roots[0];
      const children = provider.getChildren(summary);
      assert.ok(children.length >= 5, `Expected >= 5 summary items but got ${children.length}`);
    });

    test("summary shows correct acceptance rate", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ acceptanceRate: 75.3 }));
      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]);
      const rateItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Acceptance Rate");
      assert.ok(rateItem);
      assert.strictEqual(rateItem.description, "75.3%");
    });

    test("includes avg latency when > 0", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ avgLatencyMs: 300 }));
      const children = provider.getChildren(provider.getChildren()[0]);
      const latencyItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Avg Latency");
      assert.ok(latencyItem, "Should include latency item");
      assert.strictEqual(latencyItem.description, "300ms");
    });

    test("omits avg latency when 0", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ avgLatencyMs: 0 }));
      const children = provider.getChildren(provider.getChildren()[0]);
      const latencyItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Avg Latency");
      assert.strictEqual(latencyItem, undefined, "Should not include latency when 0");
    });
  });

  suite("getChildren (languages category)", () => {
    test("languages shows correct number of entries", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const langCategory = roots.find((r) => (typeof r.label === "string" ? r.label : "") === "By Language");
      assert.ok(langCategory);
      const children = provider.getChildren(langCategory);
      assert.strictEqual(children.length, 2);
    });

    test("languages are sorted by shown count descending", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const langCategory = roots.find((r) => (typeof r.label === "string" ? r.label : "") === "By Language");
      assert.ok(langCategory);
      const children = provider.getChildren(langCategory);
      const labels = children.map((c) => (typeof c.label === "string" ? c.label : ""));
      assert.strictEqual(labels[0], "typescript");
      assert.strictEqual(labels[1], "python");
    });
  });

  suite("getChildren (daily category)", () => {
    test("daily shows up to 7 entries", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const dailyCategory = roots.find((r) => (typeof r.label === "string" ? r.label : "") === "Daily (7 days)");
      assert.ok(dailyCategory);
      const children = provider.getChildren(dailyCategory);
      assert.ok(children.length <= 7, `Expected <= 7 items but got ${children.length}`);
      assert.ok(children.length > 0, "Should have at least 1 daily entry");
    });
  });

  suite("getChildren (errors category)", () => {
    test("errors category lists error types", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(
        makeStats({
          totalErrors: 5,
          errorsByType: new Map([
            ["HTTP 429", 3],
            ["Timeout", 2],
          ]),
        }),
      );
      const roots = provider.getChildren();
      const errCategory = roots.find((r) => (typeof r.label === "string" ? r.label : "") === "Errors");
      assert.ok(errCategory);
      const children = provider.getChildren(errCategory);
      assert.strictEqual(children.length, 2);
    });

    test("errors are sorted by count descending", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(
        makeStats({
          totalErrors: 5,
          errorsByType: new Map([
            ["Timeout", 2],
            ["HTTP 429", 3],
          ]),
        }),
      );
      const roots = provider.getChildren();
      const errCategory = roots.find((r) => (typeof r.label === "string" ? r.label : "") === "Errors");
      assert.ok(errCategory);
      const children = provider.getChildren(errCategory);
      const labels = children.map((c) => (typeof c.label === "string" ? c.label : ""));
      assert.strictEqual(labels[0], "HTTP 429");
      assert.strictEqual(labels[1], "Timeout");
    });
  });

  suite("getTreeItem", () => {
    test("returns the element itself", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      for (const root of roots) {
        assert.strictEqual(provider.getTreeItem(root), root);
      }
    });
  });

  suite("dispose", () => {
    test("can be called without error", () => {
      const provider = new CopilotUsageTreeProvider();
      assert.doesNotThrow(() => provider.dispose());
    });
  });
});
