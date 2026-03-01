import * as assert from "assert";
import * as vscode from "vscode";
import { StatusBarIndicator } from "../../ui/statusBarIndicator";
import type { RealtimeInlineStats } from "../../events/inlineCompletionWrapper";

suite("StatusBarIndicator", () => {
  let indicator: StatusBarIndicator;

  setup(() => {
    indicator = new StatusBarIndicator();
  });

  teardown(() => {
    indicator.dispose();
  });

  test("can be constructed and disposed", () => {
    assert.ok(indicator);
    assert.doesNotThrow(() => indicator.dispose());
  });

  test("update with undefined stats does not throw", () => {
    assert.doesNotThrow(() => indicator.update(undefined));
  });

  test("update with zero-shown stats does not throw", () => {
    const stats: RealtimeInlineStats = {
      totalShown: 0,
      totalAccepted: 0,
      byLanguage: new Map(),
    };
    assert.doesNotThrow(() => indicator.update(stats));
  });

  test("update with valid stats does not throw", () => {
    const stats: RealtimeInlineStats = {
      totalShown: 100,
      totalAccepted: 73,
      byLanguage: new Map([["typescript", { shown: 100, accepted: 73 }]]),
    };
    assert.doesNotThrow(() => indicator.update(stats));
  });

  test("dispose prevents further updates", () => {
    indicator.dispose();
    const stats: RealtimeInlineStats = {
      totalShown: 50,
      totalAccepted: 30,
      byLanguage: new Map(),
    };
    assert.doesNotThrow(() => indicator.update(stats));
  });

  test("double dispose is safe", () => {
    indicator.dispose();
    assert.doesNotThrow(() => indicator.dispose());
  });
});
