import * as assert from "assert";
import { todayDateString } from "../../src/utils";

suite("utils", () => {
  suite("todayDateString", () => {
    test("returns a string matching YYYY-MM-DD format", () => {
      const result = todayDateString();
      assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });

    test("returned date matches today's UTC date", () => {
      const result = todayDateString();
      const expected = new Date().toISOString().slice(0, 10);
      assert.strictEqual(result, expected);
    });
  });
});
