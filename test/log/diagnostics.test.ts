import * as assert from "assert";
import { summarizeModelCalls } from "../../src/log/diagnostics";

suite("SDK model call timing", () => {
  test("averages available values using separate sample counts", () => {
    assert.deepStrictEqual(
      summarizeModelCalls([
        { model: "a", durationMs: 100, firstTokenMs: 20 },
        { model: "a", durationMs: 300, firstTokenMs: null },
        { model: "b", durationMs: null, firstTokenMs: 0 },
      ]),
      [
        { model: "a", duration: 200, durationSamples: 2, firstToken: 20, firstTokenSamples: 1 },
        { model: "b", duration: null, durationSamples: 0, firstToken: 0, firstTokenSamples: 1 },
      ],
    );
  });
});
