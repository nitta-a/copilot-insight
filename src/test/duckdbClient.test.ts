import * as assert from "assert";
import type { DuckDbClient, DuckDbRow } from "../duckdbClient";
import { InMemoryAnalyticsDb, createDuckDbClient } from "../duckdbClient";
import type { TextChangeEvent, CompletionAcceptEvent } from "../eventSchema";

suite("duckdbClient – interface contract", () => {
  test("DuckDbRow is assignable from a plain object", () => {
    const row: DuckDbRow = { col1: "hello", col2: 42, col3: null };
    assert.strictEqual(row["col1"], "hello");
    assert.strictEqual(row["col2"], 42);
  });

  test("DuckDbClient interface shape is correct", () => {
    // Compile-time check: a plain object that satisfies the interface compiles without errors.
    const mock: DuckDbClient = {
      async query<T extends DuckDbRow = DuckDbRow>(_sql: string): Promise<T[]> {
        return [] as T[];
      },
      async close(): Promise<void> {},
    };

    assert.strictEqual(typeof mock.query, "function");
    assert.strictEqual(typeof mock.close, "function");
  });

  test("mock DuckDbClient query returns empty array for SELECT", async () => {
    const mock: DuckDbClient = {
      async query<T extends DuckDbRow = DuckDbRow>(_sql: string): Promise<T[]> {
        return [];
      },
      async close(): Promise<void> {},
    };

    const rows = await mock.query("SELECT 1");
    assert.deepStrictEqual(rows, []);
  });

  test("mock DuckDbClient query returns typed rows", async () => {
    interface Row extends DuckDbRow {
      id: number;
      name: string;
    }

    const mock: DuckDbClient = {
      async query<T extends DuckDbRow = DuckDbRow>(_sql: string): Promise<T[]> {
        return [{ id: 1, name: "typescript" }] as unknown as T[];
      },
      async close(): Promise<void> {},
    };

    const rows = await mock.query<Row>("SELECT id, name FROM langs");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.id, 1);
    assert.strictEqual(rows[0]?.name, "typescript");
  });

  test("mock DuckDbClient close resolves without error", async () => {
    const mock: DuckDbClient = {
      async query<T extends DuckDbRow = DuckDbRow>(_sql: string): Promise<T[]> {
        return [];
      },
      async close(): Promise<void> {},
    };

    await assert.doesNotReject(async () => {
      await mock.close();
    });
  });

  test("createDuckDbClient rejects until DuckDB package is available", async () => {
    await assert.rejects(createDuckDbClient, /DuckDB is not yet available/);
  });
});

suite("InMemoryAnalyticsDb", () => {
  test("starts with zero size", () => {
    const db = new InMemoryAnalyticsDb();
    assert.strictEqual(db.size, 0);
  });

  test("ingests raw events and increments size", () => {
    const db = new InMemoryAnalyticsDb();
    db.ingest([
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "typescript",
        charsAdded: 10,
        charsDeleted: 2,
      } as TextChangeEvent,
    ]);
    assert.strictEqual(db.size, 1);
  });

  test("query('events') returns all ingested events", async () => {
    const db = new InMemoryAnalyticsDb();
    db.ingest([
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "typescript",
        charsAdded: 10,
        charsDeleted: 2,
      } as TextChangeEvent,
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:01:00Z",
        eventType: "completionAccept",
        languageId: "python",
        modelName: "gpt-4o",
        latencyMs: 200,
        isPartialAccept: false,
        acceptedCharacters: 50,
        openEditorPaths: [],
      } as CompletionAcceptEvent,
    ]);
    const rows = await db.query("events");
    assert.strictEqual(rows.length, 2);
  });

  test("query('sessions') groups events by session", async () => {
    const db = new InMemoryAnalyticsDb();
    db.ingest([
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "ts",
        charsAdded: 5,
        charsDeleted: 0,
      } as TextChangeEvent,
      {
        sessionId: "s2",
        timestamp: "2026-02-28T11:00:00Z",
        eventType: "textChange",
        languageId: "ts",
        charsAdded: 3,
        charsDeleted: 0,
      } as TextChangeEvent,
    ]);
    const rows = await db.query("sessions");
    assert.strictEqual(rows.length, 2);
  });

  test("query('events_by_type:completionAccept') filters events", async () => {
    const db = new InMemoryAnalyticsDb();
    db.ingest([
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "ts",
        charsAdded: 5,
        charsDeleted: 0,
      } as TextChangeEvent,
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:01:00Z",
        eventType: "completionAccept",
        languageId: "ts",
        modelName: "",
        latencyMs: 0,
        isPartialAccept: false,
        acceptedCharacters: 20,
        openEditorPaths: [],
      } as CompletionAcceptEvent,
    ]);
    const rows = await db.query("events_by_type:completionAccept");
    assert.strictEqual(rows.length, 1);
  });

  test("close prevents further queries", async () => {
    const db = new InMemoryAnalyticsDb();
    db.ingest([
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "ts",
        charsAdded: 5,
        charsDeleted: 0,
      } as TextChangeEvent,
    ]);
    await db.close();
    const rows = await db.query("events");
    assert.deepStrictEqual(rows, []);
  });

  test("close prevents further ingestion", async () => {
    const db = new InMemoryAnalyticsDb();
    await db.close();
    db.ingest([
      {
        sessionId: "s1",
        timestamp: "2026-02-28T10:00:00Z",
        eventType: "textChange",
        languageId: "ts",
        charsAdded: 5,
        charsDeleted: 0,
      } as TextChangeEvent,
    ]);
    assert.strictEqual(db.size, 0);
  });

  test("implements DuckDbClient interface", async () => {
    const db: DuckDbClient = new InMemoryAnalyticsDb();
    assert.strictEqual(typeof db.query, "function");
    assert.strictEqual(typeof db.close, "function");
    await db.close();
  });
});
