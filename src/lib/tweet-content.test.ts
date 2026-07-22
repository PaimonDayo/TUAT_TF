import { describe, expect, it } from "vitest";
import {
  TWEET_MAX_LENGTH,
  tweetContentLength,
  tweetContentRemaining,
  tweetContentUrls,
  tweetUrlHost,
} from "./tweet-content";

describe("tweetContentLength", () => {
  it("counts Japanese characters and emoji by Unicode code point", () => {
    expect(tweetContentLength("練習🏃")).toBe(3);
  });

  it("counts every URL as 23 characters", () => {
    expect(tweetContentLength("見て https://example.com/a/very/long/path")).toBe(26);
    expect(tweetContentLength("https://x.co/a https://example.com/long")).toBe(47);
  });

  it("returns the remaining effective length", () => {
    expect(tweetContentRemaining("a".repeat(10))).toBe(TWEET_MAX_LENGTH - 10);
  });
});

describe("tweetContentUrls", () => {
  it("deduplicates URLs and removes trailing Japanese punctuation", () => {
    expect(
      tweetContentUrls("https://example.com/path。 https://example.com/path。 https://openai.com/"),
    ).toEqual(["https://example.com/path", "https://openai.com/"]);
  });

  it("extracts a URL embedded in Markdown without its closing delimiter", () => {
    expect(tweetContentUrls("[reference](https://example.com/guide)"))
      .toEqual(["https://example.com/guide"]);
  });

  it("provides a compact host label", () => {
    expect(tweetUrlHost("https://www.example.com/path")).toBe("example.com");
  });
});
