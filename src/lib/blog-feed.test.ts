import { describe, expect, it } from "vitest";
import { parseBlogFeed } from "./blog-feed";

describe("parseBlogFeed", () => {
  it("parses Livedoor RSS 1.0 items and decodes text", () => {
    const xml = `<rdf:RDF>
      <item rdf:about="https://nokotandf.livedoor.blog/archives/1.html">
        <title>練習 &amp; 自己紹介</title>
        <link>https://nokotandf.livedoor.blog/archives/1.html</link>
        <description><![CDATA[<p>本文です。</p><p>続きです。</p>]]></description>
        <dc:creator>runner</dc:creator>
        <dc:date>2026-07-21T13:54:21+09:00</dc:date>
        <dc:subject>自己紹介</dc:subject>
      </item>
    </rdf:RDF>`;

    expect(parseBlogFeed(xml)).toEqual([{
      title: "練習 & 自己紹介",
      url: "https://nokotandf.livedoor.blog/archives/1.html",
      description: "本文です。\n続きです。",
      publishedAt: "2026-07-21T13:54:21+09:00",
      category: "自己紹介",
      author: "runner",
    }]);
  });

  it("rejects links outside the configured blog", () => {
    expect(parseBlogFeed("<item><title>危険</title><link>https://example.com/</link></item>")).toEqual([]);
  });
});