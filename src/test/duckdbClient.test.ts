import * as assert from "assert";
import type { DuckDbClient, DuckDbRow } from "../duckdbClient";

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
});
