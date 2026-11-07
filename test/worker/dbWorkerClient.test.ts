import * as assert from "assert";
import type { ChatSessionRecord, ChatSessionTitleRecord } from "../../src/types";
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
    async setChatSessionTitles(_titles: ChatSessionTitleRecord[]) {
      return { loaded: 0 };
    },
    async setChatSessions(_sessions: ChatSessionRecord[]) {
      return { loaded: 0 };
    },
    async query<T = unknown>(_sql: string): Promise<T[]> {
      return [];
    },
    async getSessionList() {
      return [];
    },
    async getSessionDetail(_sessionId: string) {
      return null;
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
      "setChatSessionTitles",
      "setChatSessions",
      "query",
      "getSessionList",
      "getSessionDetail",
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


  test("mock DbWorkerClient setChatSessionTitles returns loaded count", async () => {
    const mock = createMockClient({
      async setChatSessionTitles(titles: ChatSessionTitleRecord[]) {
        return { loaded: titles.length };
      },
    });

    const result = await mock.setChatSessionTitles([
      {
        chatSessionId: "chat-1",
        workspaceId: "workspace-1",
        title: "Thread title",
        createdAt: "2026-03-08T10:00:00.000Z",
        lastMessageAt: null,
        firstRequestText: null,
      },
    ]);
    assert.strictEqual(result.loaded, 1);
  });

  test("mock DbWorkerClient setChatSessions returns loaded count", async () => {
    const mock = createMockClient({
      async setChatSessions(sessions: ChatSessionRecord[]) {
        return { loaded: sessions.length };
      },
    });

    const result = await mock.setChatSessions([
      {
        chatSessionId: "chat-1",
        workspaceId: "workspace-1",
        title: "Thread title",
        createdAt: "2026-03-08T10:00:00.000Z",
        lastMessageAt: null,
        firstRequestText: "Explain the issue",
        requests: [],
        source: "jsonl",
        provider: "copilot",
      },
    ]);
    assert.strictEqual(result.loaded, 1);
  });

  test("mock DbWorkerClient close resolves without error", async () => {
    const mock = createMockClient();
    await assert.doesNotReject(async () => {
      await mock.close();
    });
  });

  test("mock DbWorkerClient getSessionDetail returns null or payload shape", async () => {
    const mock = createMockClient({
      async getSessionDetail(_sessionId: string) {
        return {
          sessionId: "s1",
          date: "2026-03-07",
          totalActions: 3,
          autonomousDuration: 1000,
          timeline: [],
          episodes: [],
          fatigueMarker: null,
          threads: [],
          stepsByThread: {},
        };
      },
    });

    const result = await mock.getSessionDetail("s1");
    assert.ok(result);
    assert.strictEqual(result?.sessionId, "s1");
    assert.strictEqual(result?.timeline.length, 0);
    assert.deepStrictEqual(result?.threads, []);
  });
});
