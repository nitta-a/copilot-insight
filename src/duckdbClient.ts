import * as fs from "node:fs";
import * as path from "node:path";

import * as duckdb from "@duckdb/duckdb-wasm/blocking";

/** A single row returned from a DuckDB query. */
export type DuckDbRow = Record<string, unknown>;

/** Minimal async interface for DuckDB (Wasm) access within the extension. */
export interface DuckDbClient {
  /** Execute a SQL statement and return the result rows as plain objects. */
  query<T extends DuckDbRow = DuckDbRow>(sql: string): Promise<T[]>;
  /** Release all DuckDB resources. */
  close(): Promise<void>;
}

/**
 * Resolve the directory that contains the DuckDB Wasm binaries.
 * In a bundled extension the wasm files are copied next to extension.js (i.e. `dist/`);
 * during development they live inside `node_modules/@duckdb/duckdb-wasm/dist/`.
 */
function resolveDuckDbDistDir(): string {
  // In production the wasm files are copied alongside the bundled extension.js (dist/).
  if (fs.existsSync(path.join(__dirname, "duckdb-eh.wasm"))) {
    return __dirname;
  }
  // Fallback: resolve from node_modules (development / test context).
  return path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
}

/**
 * Initialise an in-memory DuckDB (Wasm) instance and return a client.
 *
 * Selects the EH (exception-handling) bundle when available, falling back to MVP.
 * All resources are released when `close()` is called.
 */
export async function createDuckDbClient(): Promise<DuckDbClient> {
  const distDir = resolveDuckDbDistDir();

  const bundles: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: path.join(distDir, "duckdb-mvp.wasm"),
      mainWorker: path.join(distDir, "duckdb-node-mvp.worker.cjs"),
    },
    eh: {
      mainModule: path.join(distDir, "duckdb-eh.wasm"),
      mainWorker: path.join(distDir, "duckdb-node-eh.worker.cjs"),
    },
  };

  const logger = new duckdb.VoidLogger();
  const db = await duckdb.createDuckDB(bundles, logger, duckdb.NODE_RUNTIME);
  await db.instantiate();
  const conn = db.connect();

  return {
    async query<T extends DuckDbRow = DuckDbRow>(sql: string): Promise<T[]> {
      const table = conn.query(sql);
      return table.toArray().map((row) => row.toJSON() as unknown as T);
    },
    async close(): Promise<void> {
      conn.close();
    },
  };
}
