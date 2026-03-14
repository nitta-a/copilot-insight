import * as assert from "assert";
import { extractTopKeywords } from "../../src/log/keywordExtractor";

suite("keywordExtractor", () => {
  test("returns empty array for empty input", () => {
    assert.deepStrictEqual(extractTopKeywords([]), []);
  });

  test("returns empty array for texts that produce no valid tokens", () => {
    // All tokens are stop words or too short.
    assert.deepStrictEqual(extractTopKeywords(["the a is"]), []);
  });

  test("counts and ranks basic English words", () => {
    const texts = ["typescript refactor", "typescript test", "refactor code"];
    const result = extractTopKeywords(texts);
    const words = result.map((k) => k.word);
    // "typescript" appears twice, should rank first.
    assert.strictEqual(result[0].word, "typescript");
    assert.strictEqual(result[0].count, 2);
    assert.ok(words.includes("refactor"), "refactor should be present");
    assert.ok(words.includes("code") || words.includes("test"), "other words should be present");
  });

  test("excludes English stop words", () => {
    const result = extractTopKeywords(["how to implement the feature please"]);
    const words = result.map((k) => k.word);
    for (const sw of ["how", "to", "the", "please"]) {
      assert.ok(!words.includes(sw), `stop word "${sw}" should be excluded`);
    }
    assert.ok(words.includes("implement"), "implement should be kept");
    assert.ok(words.includes("feature"), "feature should be kept");
  });

  test("excludes Japanese stop words", () => {
    const result = extractTopKeywords(["TypeScript 実装 確認 バグ 修正"]);
    const words = result.map((k) => k.word);
    for (const sw of ["実装", "確認", "修正"]) {
      assert.ok(!words.includes(sw), `Japanese stop word "${sw}" should be excluded`);
    }
    assert.ok(words.includes("typescript"), "typescript should be kept");
    assert.ok(words.includes("バグ"), "バグ should be kept");
  });

  test("excludes pure numbers", () => {
    const result = extractTopKeywords(["fix 404 error in api"]);
    const words = result.map((k) => k.word);
    assert.ok(!words.includes("404"), "pure numbers should be excluded");
  });

  test("excludes URL-like tokens", () => {
    const result = extractTopKeywords(["see https://example.com for details"]);
    const words = result.map((k) => k.word);
    assert.ok(!words.some((w) => w.startsWith("http")), "URLs should be excluded");
    assert.ok(words.includes("details"), "non-url word should be kept");
  });

  test("respects topN limit", () => {
    const texts = Array.from({ length: 30 }, (_, i) => `word${i} word${i}`);
    const result = extractTopKeywords(texts, 10);
    assert.ok(result.length <= 10, `result length ${result.length} should be <= 10`);
  });

  test("sorts by count descending", () => {
    const texts = ["alpha beta gamma", "alpha beta", "alpha"];
    const result = extractTopKeywords(texts);
    assert.strictEqual(result[0].word, "alpha");
    assert.strictEqual(result[0].count, 3);
    assert.strictEqual(result[1].word, "beta");
    assert.strictEqual(result[1].count, 2);
    assert.strictEqual(result[2].word, "gamma");
    assert.strictEqual(result[2].count, 1);
  });

  test("tokens are lower-cased", () => {
    const result = extractTopKeywords(["TypeScript TypeScript TYPESCRIPT"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].word, "typescript");
    assert.strictEqual(result[0].count, 3);
  });

  test("handles mixed English and Japanese text", () => {
    const texts = ["React コンポーネント 設計", "React TypeScript 設計"];
    const result = extractTopKeywords(texts);
    const words = result.map((k) => k.word);
    assert.ok(words.includes("react"), "react should be present");
    assert.ok(words.includes("設計"), "設計 should be present");
    assert.ok(!words.includes("実装"), "実装 stop word should be excluded");
  });

  test("skips empty strings in input array", () => {
    const result = extractTopKeywords(["", "  ", "typescript"]);
    assert.ok(
      result.some((k) => k.word === "typescript"),
      "non-empty word should still be counted",
    );
  });
});
