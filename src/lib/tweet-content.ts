export const TWEET_MAX_LENGTH = 1000;
export const TWEET_URL_WEIGHT = 23;
export const TWEET_RAW_MAX_LENGTH = 8000;

// Markdown links (`[label](https://...)`) also end cleanly at `)` or `>`.
const URL_PATTERN = /https?:\/\/[^\s<>)]+/giu;
const TRAILING_PUNCTUATION = /[)\]｝」』。、，．,.!?！？]+$/u;

const codePointLength = (value: string) => Array.from(value).length;

/** Xと同様に、URLの実際の長さではなく1件23文字として数える。 */
export function tweetContentLength(content: string): number {
  let length = 0;
  let cursor = 0;
  const pattern = new RegExp(URL_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    length += codePointLength(content.slice(cursor, match.index));
    length += TWEET_URL_WEIGHT;
    cursor = match.index + match[0].length;
  }
  return length + codePointLength(content.slice(cursor));
}

export function tweetContentRemaining(content: string): number {
  return TWEET_MAX_LENGTH - tweetContentLength(content);
}

/** 入力中のURLを、表示用に末尾の句読点を除いて重複なしで返す。 */
export function tweetContentUrls(content: string): string[] {
  const matches = content.match(new RegExp(URL_PATTERN)) ?? [];
  return [...new Set(matches.map((url) => url.replace(TRAILING_PUNCTUATION, "")).filter(Boolean))];
}

export function tweetUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
