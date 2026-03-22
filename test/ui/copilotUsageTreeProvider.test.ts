import * as assert from "assert";
import type { CopilotUsageStats } from "../../src/types";
import { CopilotUsageTreeProvider } from "../../src/ui/copilotUsageTreeProvider";

function makeStats(overrides?: Partial<CopilotUsageStats>): CopilotUsageStats {
  return {
    totalShown: 100,
    totalAccepted: 70,
    totalRejected: 30,
    totalChat: 15,
    acceptanceRate: 70.0,
    avgLatencyMs: 250,
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
    bySession: new Map([["session-1", { sessionId: "session-1", shown: 60, accepted: 40, chat: 10, errors: 0 }]]),
    byContextSource: new Map(),
    byContextEffectiveness: new Map(),
    subagentRequests: 0,
    agenticRatio: 0,
    autonomousDurationMs: 0,
    toolUsageStats: new Map(),
    subagentLoops: 0,
    subagentLoopsStarted: 0,
    completionRate: 0,
    subagentByModel: new Map(),
    autonomousDurationByModel: new Map(),
    agenticDepthByModel: new Map(),
    byDateAgenticDepth: new Map(),
    planCount: 0,
    executedPlanCount: 0,
    userChoicesInPlan: 0,
    browserToolInvocations: 0,
    browserToolsByType: new Map(),
    pluginOrSkillInvocations: 0,
    pluginOrSkillByName: new Map(),
    memoryManagementEvents: [],
    sessionSignals: [],
    memoryManagementByType: new Map(),
    agentDebugEvents: 0,
    agentDebugByType: new Map(),
    cliByDate: new Map(),
    cliTotalInteractions: 0,
    commandUsage: new Map(),
    promptEffectiveness: {},
    chatSessionStates: new Map(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    tokensByModel: new Map(),
    finishReasonCounts: new Map(),
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
    test("returns show-usage action plus 3 category nodes when no errors", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ totalErrors: 0 }));
      const roots = provider.getChildren();
      assert.strictEqual(roots.length, 4);
    });

    test("returns show-usage action plus 4 category nodes when errors exist", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ totalErrors: 3, errorsByType: new Map([["HTTP 500", 3]]) }));
      const roots = provider.getChildren();
      assert.strictEqual(roots.length, 5);
    });

    test("show usage action appears before KPI category", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      assert.strictEqual(typeof roots[0]?.label === "string" ? roots[0].label : "", "Show Usage");
    });

    test("root labels are correct", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const labels = roots.map((r) => (typeof r.label === "string" ? r.label : ""));
      assert.ok(labels.includes("Show Usage"));
      assert.ok(labels.includes("Key Performance Indicators"));
      assert.ok(labels.includes("Weekly Trend"));
      assert.ok(!labels.includes("By Language"));
      assert.ok(labels.includes("Daily (7 days)"));
    });
  });

  suite("getChildren (summary category)", () => {
    test("KPI section has at least 4 items", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection, "Key Performance Indicators section should exist");
      const children = provider.getChildren(kpiSection);
      assert.ok(children.length >= 4, `Expected >= 4 KPI items but got ${children.length}`);
    });

    test("KPI section shows correct acceptance rate", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ acceptanceRate: 75.3 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const rateItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Acceptance Rate");
      assert.ok(rateItem);
      assert.strictEqual(rateItem.description, "75.3%");
    });

    test("includes avg latency when > 0", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ avgLatencyMs: 300 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const latencyItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Avg Latency");
      assert.ok(latencyItem, "Should include latency item");
      assert.strictEqual(latencyItem.description, "300ms");
    });

    test("omits avg latency when 0", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats({ avgLatencyMs: 0 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const latencyItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Avg Latency");
      assert.strictEqual(latencyItem, undefined, "Should not include latency when 0");
    });

    test("ROI rank badge: no badge below 60 minutes", () => {
      const provider = new CopilotUsageTreeProvider();
      // totalAccepted=10, formula: 10*40/200=2 minutes, autonomousDurationMs=0
      provider.updateStats(makeStats({ totalAccepted: 10, autonomousDurationMs: 0 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const roiItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Time Saved (ROI)");
      assert.ok(roiItem);
      const desc = roiItem.description as string;
      assert.ok(
        !desc.includes("✨") && !desc.includes("⭐") && !desc.includes("🏆"),
        `Expected no badge but got: ${desc}`,
      );
    });

    test("ROI rank badge: ✨ at 60 minutes", () => {
      const provider = new CopilotUsageTreeProvider();
      // totalAccepted=750: 750*40/200 = 150 minutes → ≥60 but <180 → ✨ tier
      provider.updateStats(makeStats({ totalAccepted: 750, autonomousDurationMs: 0 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const roiItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Time Saved (ROI)");
      assert.ok(roiItem);
      const desc = roiItem.description as string;
      assert.ok(desc.includes("✨"), `Expected ✨ badge but got: ${desc}`);
    });

    test("ROI rank badge: 🏆 at 600+ minutes", () => {
      const provider = new CopilotUsageTreeProvider();
      // autonomousDurationMs = 600 min * 60000ms / 0.5 = 72_000_000ms
      provider.updateStats(makeStats({ totalAccepted: 0, autonomousDurationMs: 72_000_000 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const roiItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Time Saved (ROI)");
      assert.ok(roiItem);
      const desc = roiItem.description as string;
      assert.ok(desc.includes("🏆"), `Expected 🏆 badge but got: ${desc}`);
    });

    test("shows Active Sessions count", () => {
      const provider = new CopilotUsageTreeProvider();
      provider.updateStats(makeStats());
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const sessItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Active Sessions");
      assert.ok(sessItem, "Should have Active Sessions item");
      assert.strictEqual(sessItem.description, "1"); // makeStats has 1 session
    });

    test("CLI interactions are included in Time Saved (ROI)", () => {
      const provider = new CopilotUsageTreeProvider();
      // editor=0, cli=2 interactions × 30min = 60min → should show ✨1h
      provider.updateStats(makeStats({ totalAccepted: 0, autonomousDurationMs: 0, cliTotalInteractions: 2 }));
      const roots = provider.getChildren();
      const kpiSection = roots.find(
        (r) => (typeof r.label === "string" ? r.label : "") === "Key Performance Indicators",
      );
      assert.ok(kpiSection);
      const children = provider.getChildren(kpiSection);
      const roiItem = children.find((c) => (typeof c.label === "string" ? c.label : "") === "Time Saved (ROI)");
      assert.ok(roiItem, "Should have Time Saved (ROI) item");
      const desc = roiItem.description as string;
      // 2 interactions × 30min default = 60min = 1h → ✨ tier badge
      assert.ok(desc.includes("1h"), `Expected '1h' in description but got: ${desc}`);
      assert.ok(desc.includes("✨"), `Expected ✨ badge (CLI brings total to 60 min) but got: ${desc}`);
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
