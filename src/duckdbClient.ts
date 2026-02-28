/** A single row returned from a DuckDB query. */
export type DuckDbRow = Record<string, unknown>;

/** Minimal async interface for DuckDB access within the extension. */
export interface DuckDbClient {
  /** Execute a SQL statement and return the result rows as plain objects. */
  query<T extends DuckDbRow = DuckDbRow>(sql: string): Promise<T[]>;
  /** Release all DuckDB resources. */
  close(): Promise<void>;
}

/**
 * Initialise an in-memory DuckDB instance and return a client.
 *
 * The DuckDB (Wasm) package is not yet wired in due to a security advisory on
 * all published versions of `@duckdb/duckdb-wasm`. This factory is a placeholder
 * that preserves the interface contract; the body will be filled in once a
 * safe version of the package becomes available.
 */
export async function createDuckDbClient(): Promise<DuckDbClient> {
  throw new Error("DuckDB is not yet available: the @duckdb/duckdb-wasm package has an open security advisory.");
}
