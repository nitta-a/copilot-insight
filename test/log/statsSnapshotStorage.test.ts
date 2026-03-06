import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { StatsSnapshotStorage } from "../../src/log/statsSnapshotStorage";
import type { CopilotUsageStats } from "../../src/types";

function makeStats(): CopilotUsageStats {
  return {
    totalShown: 12,
    totalAccepted: 7,
    totalRejected: 5,
    totalChat: 3,
    acceptanceRate: 58.3,
    avgLatencyMs: 210,
    byDate: new Map([["2026-03-01", { shown: 12, accepted: 7 }]]),
    byModel: new Map([["gpt-4.1", { shown: 12, accepted: 7 }]]),
    byChatModel: new Map([["gpt-4.1", 3]]),
    byHour: new Map([["10", 5]]),
    byChatIntent: new Map([["Agent", 3]]),
    logFilesFound: 4,
    chatByDate: new Map([["2026-03-01", 3]]),
    chatByHour: new Map([["10", 2]]),
    totalErrors: 1,
    errorsByType: new Map([["HTTP 429", 1]]),
    latencies: [100, 200, 300],
    chatLatencies: [150, 250],
    latencyP50: 200,
    latencyP95: 300,
    latencyP99: 300,
    chatAvgLatencyMs: 200,
    chatLatencyP50: 150,
    chatLatencyP95: 250,
    bySession: new Map([["session-1", { sessionId: "session-1", shown: 12, accepted: 7, chat: 3, errors: 1 }]]),
    byContextSource: new Map([["Workspace", 4]]),
    byContextEffectiveness: new Map([["Workspace", { shown: 5, accepted: 2 }]]),
    subagentRequests: 2,
    agenticRatio: 13.3,
    autonomousDurationMs: 999,
    toolUsageStats: new Map([["runSubagent", 2]]),
    subagentLoops: 1,
    subagentLoopsStarted: 2,
    completionRate: 50,
    subagentByModel: new Map([["gpt-4.1", 2]]),
    autonomousDurationByModel: new Map([["gpt-4.1", 999]]),
    agenticDepthByModel: new Map([
      [
        "gpt-4.1",
        {
          loopDistribution: {
            bucket1: 0,
            bucket2: 1,
            bucket3to5: 0,
            bucket6to10: 0,
            bucket11plus: 0,
          },
          avgLoopActions: 2,
          completionRate: 50,
          velocityMsPerAction: 499.5,
        },
      ],
    ]),
    byDateAgenticDepth: new Map([
      [
        "2026-03-01",
        {
          loopDistribution: {
            bucket1: 0,
            bucket2: 1,
            bucket3to5: 0,
            bucket6to10: 0,
            bucket11plus: 0,
          },
          avgLoopActions: 2,
          completionRate: 50,
          velocityMsPerAction: 499.5,
        },
      ],
    ]),
    planCount: 1,
    executedPlanCount: 1,
    userChoicesInPlan: 0,
  };
}

suite("StatsSnapshotStorage", () => {
  test("writes and restores usage stats across restarts", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-stats-"));
    try {
      const storage = new StatsSnapshotStorage(tempRoot);
      const expected = makeStats();

      await storage.write(expected);
      const restored = await storage.read();

      assert.ok(restored);
      assert.strictEqual(restored?.totalShown, expected.totalShown);
      assert.deepStrictEqual([...(restored?.byDate.entries() ?? [])], [...expected.byDate.entries()]);
      assert.deepStrictEqual([...(restored?.byModel.entries() ?? [])], [...expected.byModel.entries()]);
      assert.deepStrictEqual(
        [...(restored?.agenticDepthByModel.entries() ?? [])],
        [...expected.agenticDepthByModel.entries()],
      );
      assert.deepStrictEqual(
        [...(restored?.byDateAgenticDepth.entries() ?? [])],
        [...expected.byDateAgenticDepth.entries()],
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("returns undefined for missing snapshot", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-stats-missing-"));
    try {
      const storage = new StatsSnapshotStorage(tempRoot);
      const restored = await storage.read();
      assert.strictEqual(restored, undefined);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
