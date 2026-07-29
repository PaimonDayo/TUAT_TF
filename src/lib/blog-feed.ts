export const BLOG_HOME_URL = "https://nokotandf.livedoor.blog/";
export const BLOG_FEED_URL = `${BLOG_HOME_URL}index.rdf`;

export type BlogFeedItem = {
  title: string;
  url: string;
  description: string;
  publishedAt: string;
  category: string | null;
  author: string | null;
};

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function textOf(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return "";
  return decodeEntities(
    match[1]
      .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function safeBlogUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "nokotandf.livedoor.blog"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseBlogFeed(xml: string): BlogFeedItem[] {
  return Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)).flatMap((match) => {
    const item = match[1];
    const url = safeBlogUrl(textOf(item, "link"));
    const title = textOf(item, "title");
    if (!url || !title) return [];
    return [{
      title,
      url,
      description: textOf(item, "description"),
      publishedAt: textOf(item, "dc:date"),
      category: textOf(item, "dc:subject") || null,
      author: textOf(item, "dc:creator") || null,
    }];
  });
}

export async function getBlogFeed(): Promise<BlogFeedItem[]> {
  const response = await fetch(BLOG_FEED_URL, {
    headers: { Accept: "application/rdf+xml, application/xml, text/xml" },
    next: { revalidate: 15 * 60 },
  });
  if (!response.ok) throw new Error(`Blog feed request failed: ${response.status}`);
  return parseBlogFeed(await response.text());
}