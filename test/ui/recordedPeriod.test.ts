import * as assert from "node:assert/strict";
import { parseFusion, summarizeFusion } from "../../src/log/fusion";
import { parseInterventions, summarizeInterventions } from "../../src/log/interventions";
import { recordedPeriod } from "../../webview/utils/recordedPeriod";

suite("recorded event periods", () => {
  test("uses the latest event or usage date with inclusive boundaries", () => {
    assert.deepEqual(recordedPeriod("30", [null, "2026-11-05"]), { start: "2026-10-07", end: "2026-11-05" });
    assert.deepEqual(recordedPeriod("7", ["2026-11-04", "2026-11-05"]), { start: "2026-10-30", end: "2026-11-05" });
    assert.deepEqual(recordedPeriod("7", ["2026-11-05", "2026-11-04"]), { start: "2026-10-30", end: "2026-11-05" });
    assert.deepEqual(recordedPeriod("7", [null]), { start: "9999-99-99", end: null });
    assert.deepEqual(recordedPeriod("all", ["2026-11-05"]), { start: null, end: null });
  });

  test("includes dated Fusion and intervention events with their own latest dates", () => {
    const runs = parseFusion(
      JSON.stringify({ type: "session.fusion_resolved", timestamp: "2026-11-05T01:00:00Z", data: { fusionId: "f" } }),
    );
    const fusionRange = recordedPeriod("30", [null, ...runs.map((run) => run.timestamp?.slice(0, 10))]);
    assert.equal(summarizeFusion(runs, fusionRange.start, fusionRange.end).count, 1);

    const interventions = parseInterventions(
      JSON.stringify({
        type: "permission.completed",
        timestamp: "2026-11-05T01:00:00Z",
        data: { requestId: "r", decisionSource: "human_response" },
      }),
    );
    const interventionRange = recordedPeriod("7", [
      "2026-11-04",
      interventions.permissions[0].respondedAt?.slice(0, 10),
    ]);
    assert.equal(summarizeInterventions([{ interventions }], interventionRange.start, interventionRange.end).human, 1);
  });
});
