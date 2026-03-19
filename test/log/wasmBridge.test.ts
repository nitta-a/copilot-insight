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
    const sample: WasmParseResult = {
      totalShown: 10,
      totalAccepted: 3,
      totalChat: 5,
      subagentRequests: 2,
      planCount: 1,
      byModelShown: { "gpt-4o": 7, "claude-3.5-sonnet": 3 },
      byModelAccepted: { "gpt-4o": 3 },
      byDate: { "2024-06-15": { shown: 5, accepted: 2 } },
      byHour: { "14": 3, "09": 7 },
      latencies: [120, 290, 450],
      byContextSource: { vscodePrompt: 4, activeDocument: 1 },
    };
    assert.strictEqual(sample.totalShown, 10);
    assert.strictEqual(sample.totalAccepted, 3);
    assert.strictEqual(sample.totalChat, 5);
    assert.strictEqual(sample.subagentRequests, 2);
    assert.strictEqual(sample.planCount, 1);
    assert.strictEqual(sample.byModelShown["gpt-4o"], 7);
    assert.strictEqual(sample.byModelAccepted["gpt-4o"], 3);
    assert.strictEqual(sample.byDate["2024-06-15"]?.shown, 5);
    assert.strictEqual(sample.byDate["2024-06-15"]?.accepted, 2);
    assert.strictEqual(sample.byHour["14"], 3);
    assert.deepStrictEqual(sample.latencies, [120, 290, 450]);
    assert.strictEqual(sample.byContextSource["vscodePrompt"], 4);
  });
});
