/**
 * Keyword extractor — tokenises text from chat session titles and CLI prompts,
 * filters stop words, and returns the top-N most frequent terms.
 *
 * No external dependencies; uses only built-in string and regex operations.
 * All patterns are linear-time to avoid ReDoS.
 */

// ---------------------------------------------------------------------------
// Stop-word lists
// ---------------------------------------------------------------------------

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "not",
  "nor",
  "so",
  "yet",
  "for",
  "as",
  "at",
  "by",
  "in",
  "of",
  "on",
  "to",
  "up",
  "it",
  "its",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "how",
  "what",
  "when",
  "where",
  "who",
  "whom",
  "which",
  "why",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "they",
  "them",
  "their",
  "if",
  "then",
  "than",
  "also",
  "just",
  "too",
  "very",
  "more",
  "all",
  "no",
  "from",
  "with",
  "about",
  "into",
  "please",
  "here",
  "there",
  "out",
  "off",
  "over",
  "same",
  "other",
  "each",
  "both",
  "such",
  "only",
  "some",
  "any",
]);

const JAPANESE_STOP_WORDS = new Set([
  "実装",
  "お願い",
  "コード",
  "エラー",
  "ついて",
  "変更",
  "追加",
  "修正",
  "確認",
  "について",
  "します",
  "してください",
  "してほしい",
  "ください",
  "ます",
  "です",
  "した",
  "して",
  "する",
  "しても",
  "が",
  "を",
  "は",
  "に",
  "で",
  "と",
  "の",
  "も",
  "や",
  "から",
  "より",
  "まで",
  "など",
  "ため",
  "これ",
  "それ",
  "あれ",
  "この",
  "その",
  "あの",
  "どの",
  "こと",
  "もの",
  "ある",
  "いる",
  "ない",
  "なる",
  "れる",
  "られる",
  "せる",
  "させる",
  "たい",
  "ほしい",
  "みる",
  "おく",
  "いく",
  "くる",
  "くれる",
  "もらう",
]);

// ---------------------------------------------------------------------------
// Tokeniser helpers
// ---------------------------------------------------------------------------

/** Strip URL-like tokens (http/https/ftp schemes). */
const URL_PATTERN = /^https?:\/\//;

/** Strip markdown code fences or backticks. */
const BACKTICK_PATTERN = /^`+|`+$/g;

/** Characters used as word-separators (not part of a token). */
const SPLIT_PATTERN =
  /[\s\u3000\uff0c\u3001\u3002\uff01\uff1f!"#$%&'()*+,\-./:;<=>?@[\\\]^_{|}~\u300c\u300d\u300e\u300f\u3010\u3011]+/;

/**
 * Split `text` into lower-cased tokens, removing stop words and tokens
 * shorter than `minLength` characters.
 */
function tokenise(text: string, minLength = 2): string[] {
  // Strip URLs before splitting so that "https://example.com" doesn't bleed
  // through as "https", "example.com" when the splitter breaks on "/" and ":".
  const stripped = text.replace(/https?:\/\/[^\s]*/g, " ");
  const tokens: string[] = [];
  const raw = stripped.split(SPLIT_PATTERN);
  for (const part of raw) {
    // Strip leading/trailing backticks (inline code markers).
    const cleaned = part.replace(BACKTICK_PATTERN, "").trim();
    if (!cleaned) {
      continue;
    }
    // Reject URL-like tokens.
    if (URL_PATTERN.test(cleaned)) {
      continue;
    }
    // Reject pure numeric strings.
    if (/^\d+$/.test(cleaned)) {
      continue;
    }
    const lower = cleaned.toLowerCase();
    if (lower.length < minLength) {
      continue;
    }
    if (ENGLISH_STOP_WORDS.has(lower)) {
      continue;
    }
    // Japanese stop words are case-sensitive by nature; check original form only.
    if (JAPANESE_STOP_WORDS.has(cleaned)) {
      continue;
    }
    tokens.push(lower);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface KeywordEntry {
  word: string;
  count: number;
}

/**
 * Extract the top-`topN` most frequent keywords from an array of text strings.
 *
 * Each string is tokenised independently; tokens are lower-cased, deduplicated
 * per-document where appropriate, and aggregated into a global frequency map.
 *
 * @param texts  Array of raw text strings (titles, prompts, …).
 * @param topN   Maximum number of entries to return (default 20).
 * @returns      Sorted array of `{ word, count }` objects, descending by count.
 */
export function extractTopKeywords(texts: string[], topN = 20): KeywordEntry[] {
  const freq = new Map<string, number>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const token of tokenise(text)) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}
