import * as assert from "assert";
import type { MemoryManagementEvent } from "../../src/types";
import type { DbWorkerClient } from "../../src/worker/dbWorkerClient";

/** Factory that creates a base mock implementing {@link DbWorkerClient}. */
function createMockClient(overrides?: Partial<DbWorkerClient>): DbWorkerClient {
  return {
    async loadFromJsonl(_storagePath: string) {
      return { loaded: 0 };
    },
    async ingest(_events) {
      return { ingested: 0, total: 0 };
    },
    async query<T = unknown>(_sql: string): Promise<T[]> {
      return [];
    },
    async trueRate(_totalShown: number, _windowMs?: number) {
      return { rawAccepted: 0, trueAccepted: 0, rawRate: 0, trueRate: 0, revertedCount: 0 };
    },
    async velocity(_windowMs?: number) {
      return { timeSeries: [], averageKpm: 0, disruptionCount: 0 };
    },
    async modelPerformance() {
      return { crossTab: [], bestModelByLanguage: new Map() };
    },
    async getRefreshAnalysis(_options: {
      memoryEvents: MemoryManagementEvent[];
      windowMs?: number;
      turnWindowSize?: number;
      revertWindowMs?: number;
    }) {
      return [];
    },
    async compact(_ttlMs?: number) {
      return { compacted: 0 };
    },
    async close() {},
    ...overrides,
  };
}

suite("DbWorkerClient – interface contract", () => {
  test("DbWorkerClient interface has the expected methods", () => {
    const methodNames: (keyof DbWorkerClient)[] = [
      "loadFromJsonl",
      "ingest",
      "query",
      "trueRate",
      "velocity",
      "modelPerformance",
      "getRefreshAnalysis",
      "compact",
      "close",
    ];

    const mock = createMockClient();
    for (const method of methodNames) {
      assert.strictEqual(typeof mock[method], "function", `Expected ${String(method)} to be a function`);
    }
  });

  test("mock DbWorkerClient loadFromJsonl resolves with loaded count", async () => {
    const mock = createMockClient({
      async loadFromJsonl(_storagePath: string) {
        return { loaded: 42 };
      },
    });

    const result = await mock.loadFromJsonl("/tmp/storage");
    assert.strictEqual(result.loaded, 42);
  });

  test("mock DbWorkerClient trueRate returns correct shape", async () => {
    const mock = createMockClient({
      async trueRate(_totalShown: number, _windowMs?: number) {
        return { rawAccepted: 10, trueAccepted: 8, rawRate: 50, trueRate: 40, revertedCount: 2 };
      },
    });

    const result = await mock.trueRate(20);
    assert.strictEqual(result.rawAccepted, 10);
    assert.strictEqual(result.trueAccepted, 8);
    assert.strictEqual(result.revertedCount, 2);
    assert.strictEqual(result.rawRate, 50);
    assert.strictEqual(result.trueRate, 40);
  });

  test("mock DbWorkerClient modelPerformance returns Map for bestModelByLanguage", async () => {
    const mock = createMockClient({
      async modelPerformance() {
        return {
          crossTab: [
            {
              modelName: "gpt-4o",
              languageId: "typescript",
              totalAccepted: 10,
              totalCharsAccepted: 500,
              avgLatencyMs: 200,
            },
          ],
          bestModelByLanguage: new Map([["typescript", "gpt-4o"]]),
        };
      },
    });

    const result = await mock.modelPerformance();
    assert.ok(result.bestModelByLanguage instanceof Map);
    assert.strictEqual(result.bestModelByLanguage.get("typescript"), "gpt-4o");
    assert.strictEqual(result.crossTab.length, 1);
    assert.strictEqual(result.crossTab[0]?.modelName, "gpt-4o");
  });

  test("mock DbWorkerClient close resolves without error", async () => {
    const mock = createMockClient();
    await assert.doesNotReject(async () => {
      await mock.close();
    });
  });
});
