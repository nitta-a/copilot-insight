import * as assert from "assert";
import { type WasmParseResult, parseLogChunkWasm, resetWasmModule } from "../../src/log/wasmBridge";

suite("wasmBridge", () => {
  setup(() => {
    // Reset the cached Wasm module before each test so we get a fresh state.
    resetWasmModule();
  });

  test("parseLogChunkWasm returns null when Wasm module is not built", async () => {
    const result = await parseLogChunkWasm("some log text");
    // The Wasm artefact is not compiled during the normal test run so we
    // expect the bridge to gracefully return null.
    assert.strictEqual(result, null);
  });

  test("WasmParseResult interface matches expected shape", () => {
    // Verify the interface can be used as a type guard at compile time.
    const sample: WasmParseResult = { totalLines: 10, jsonLines: 3 };
    assert.strictEqual(sample.totalLines, 10);
    assert.strictEqual(sample.jsonLines, 3);
  });
});
