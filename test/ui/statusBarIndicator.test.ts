import * as assert from "assert";
import { StatusBarIndicator } from "../../src/ui/statusBarIndicator";

suite("StatusBarIndicator", () => {
  test("can be constructed and disposed", () => {
    const indicator = new StatusBarIndicator();
    assert.doesNotThrow(() => indicator.dispose());
  });
});
