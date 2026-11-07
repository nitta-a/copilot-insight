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
    subagentRequests: 2,
    autonomousDurationMs: 999,
    toolUsageStats: new Map([["runSubagent", 2]]),
    subagentByModel: new Map([["gpt-4.1", 2]]),
    autonomousDurationByModel: new Map([["gpt-4.1", 999]]),
    browserToolInvocations: 2,
    browserToolsByType: new Map([["screenshot", 2]]),
    pluginOrSkillInvocations: 3,
    pluginOrSkillByName: new Map([["code-search", 3]]),
    memoryManagementEvents: [
      {
        timestamp: "2026-03-01T10:00:00Z",
        type: "compact",
        rawText: "/compact",
        sessionId: "session-1",
      },
    ],
    sessionSignals: [],
    chatSessionTitles: [
      {
        chatSessionId: "chat-1",
        workspaceId: "workspace-1",
        title: "Session Intelligence Explorer",
        createdAt: "2026-03-01T09:58:00.000Z",
        lastMessageAt: "2026-03-01T10:05:00.000Z",
        firstRequestText: "Implement session explorer",
      },
    ],
    memoryManagementByType: new Map([["compact", 1]]),
    agentDebugEvents: 4,
    agentDebugByType: new Map([["step-execution", 4]]),
    cliByDate: new Map([
      [
        "2026-03-01",
        {
          prompts: 2,
          outputTokens: 20,
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 80,
            cacheWriteTokens: 10,
            reasoningTokens: 5,
            totalNanoAiu: 1_500_000_000,
          },
        },
      ],
    ]),
    cliTotalInteractions: 0,
    cliUsage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      reasoningTokens: 5,
      totalNanoAiu: 1_500_000_000,
    },
    cliUsageByModel: new Map([
      [
        "gpt-6-luna",
        {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 80,
          cacheWriteTokens: 10,
          reasoningTokens: 5,
          totalNanoAiu: 1_500_000_000,
        },
      ],
    ]),
    cliToolExecutions: new Map([["read_file", { total: 3, success: 2, fail: 1 }]]),
    cliAgentTypes: new Map([
      ["planner", 2],
      ["researcher", 1],
    ]),
    commandUsage: new Map([["@workspace", 3]]),
    promptEffectiveness: {},
    chatSessionStates: new Map([["session-1", { sessionId: "session-1", turnCount: 2, isAccepted: true }]]),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    tokensByModel: new Map(),
    finishReasonCounts: new Map(),
  };
}

suite("StatsSnapshotStorage", () => {
  test("writes and restores usage stats across restarts", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-stats-"));
    try {
      const storage = new StatsSnapshotStorage(tempRoot);
      const expected = makeStats();
      expected.cliThreads = [
        {
          sessionId: "cli-thread",
          title: "Example conversation",
          startedAt: "2026-03-01T00:00:00Z",
          lastActivityAt: "2026-03-02T00:00:00Z",
          prompts: 1,
          usage: { ...expected.cliUsage!, totalNanoAiu: null },
          turns: [{ timestamp: "2026-03-01T00:00:00Z", prompt: "Example prompt", usage: expected.cliUsage! }],
        },
      ];

      await storage.write(expected);
      const restored = await storage.read();

      assert.ok(restored);
      assert.strictEqual(restored?.totalShown, expected.totalShown);
      assert.deepStrictEqual([...(restored?.byDate.entries() ?? [])], [...expected.byDate.entries()]);
      assert.deepStrictEqual([...(restored?.byModel.entries() ?? [])], [...expected.byModel.entries()]);
      assert.deepStrictEqual([...(restored?.cliByDate.entries() ?? [])], [...expected.cliByDate.entries()]);
      assert.deepStrictEqual(restored?.cliUsage, expected.cliUsage);
      assert.deepStrictEqual(restored?.cliThreads, expected.cliThreads);
      assert.deepStrictEqual(
        [...(restored?.cliUsageByModel?.entries() ?? [])],
        [...(expected.cliUsageByModel?.entries() ?? [])],
      );
      assert.deepStrictEqual(
        [...(restored?.browserToolsByType.entries() ?? [])],
        [...expected.browserToolsByType.entries()],
      );
      assert.deepStrictEqual(
        [...(restored?.pluginOrSkillByName.entries() ?? [])],
        [...expected.pluginOrSkillByName.entries()],
      );
      assert.deepStrictEqual(
        [...(restored?.memoryManagementByType.entries() ?? [])],
        [...expected.memoryManagementByType.entries()],
      );
      assert.deepStrictEqual(restored?.memoryManagementEvents, expected.memoryManagementEvents);
      assert.deepStrictEqual(restored?.chatSessionTitles, expected.chatSessionTitles);
      assert.deepStrictEqual(
        [...(restored?.agentDebugByType.entries() ?? [])],
        [...expected.agentDebugByType.entries()],
      );
      assert.deepStrictEqual(
        [...(restored?.cliToolExecutions?.entries() ?? [])],
        [...(expected.cliToolExecutions?.entries() ?? [])],
      );
      assert.deepStrictEqual(
        [...(restored?.cliAgentTypes?.entries() ?? [])],
        [...(expected.cliAgentTypes?.entries() ?? [])],
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("reads snapshots that still contain removed derived metrics", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-stats-old-metrics-"));
    try {
      const storage = new StatsSnapshotStorage(tempRoot);
      const expected = makeStats();
      await storage.write(expected);
      const snapshotPath = path.join(tempRoot, "usage-stats.json");
      const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf-8"));
      Object.assign(snapshot.stats, {
        agenticRatio: 42,
        completionRate: 50,
        agenticDepthByModel: [["old", {}]],
        byDateAgenticDepth: [["2026-01-01", {}]],
      });
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
      const restored = await storage.read();
      assert.ok(restored);
      assert.equal(restored.totalShown, expected.totalShown);
      assert.deepStrictEqual(restored.cliUsage, expected.cliUsage);
      assert.deepStrictEqual(restored.cliThreads, expected.cliThreads);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("invalidates snapshots predating permission parsing", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-stats-fusion-"));
    try {
      const storage = new StatsSnapshotStorage(tempRoot);
      await storage.write(makeStats());
      const snapshotPath = path.join(tempRoot, "usage-stats.json");
      const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf-8"));
      snapshot.version = 3;
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
      assert.equal(await storage.read(), undefined);
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

  test("does not present legacy session-start usage as timestamped daily consumption", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-stats-legacy-"));
    try {
      const storage = new StatsSnapshotStorage(tempRoot);
      const expected = makeStats();
      await storage.write(expected);
      const snapshotPath = path.join(tempRoot, "usage-stats.json");
      const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf-8"));
      delete snapshot.stats.cliUsageDateBasis;
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
      const restored = await storage.read();
      assert.deepStrictEqual(restored?.cliUsage, expected.cliUsage);
      assert.ok(restored?.cliByDate.size);
      assert.ok([...restored.cliByDate.values()].every((day) => day.usage === undefined));
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
