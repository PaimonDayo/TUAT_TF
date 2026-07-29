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

export type BlogArticle = BlogFeedItem & { id: string; html: string };

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

export function safeBlogUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "nokotandf.livedoor.blog"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export function blogArticleId(value: string): string | null {
  const url = safeBlogUrl(value);
  return url?.match(/\/archives\/(\d+)\.html$/)?.[1] ?? null;
}

function attributeOf(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeEntities(html.match(new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(Boolean) ?? "");
}

function safeMediaUrl(value: string): string | null {
  try { const url = new URL(value, BLOG_HOME_URL); return url.protocol === "https:" && ["livedoor.blogimg.jp", "resize.blogsys.jp", "i.ytimg.com"].includes(url.hostname) ? url.toString() : null; } catch { return null; }
}

export function sanitizeBlogArticleHtml(value: string): string {
  const clean = value.replace(/<(script|style|iframe|object|embed|form|button)[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<(script|style|iframe|object|embed|form|button)\b[^>]*\/?>/gi, "");
  const allowed = new Set(["p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "del", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "img", "a"]);
  const sanitized = clean.replace(/<\/?([a-z][\w-]*)(?:\s[^>]*)?>/gi, (tag, rawName: string) => {
    const name = rawName.toLowerCase(); if (!allowed.has(name)) return ""; if (tag.startsWith("</")) return `</${name}>`; if (name === "br") return "<br>";
    if (name === "img") { const src = safeMediaUrl(attributeOf(tag, "src")); if (!src) return ""; const alt = attributeOf(tag, "alt").replace(/[<>"']/g, ""); return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`; }
    if (name === "a") { const href = safeBlogUrl(attributeOf(tag, "href")); return href ? `<a href="${href}">` : "<span>"; }
    return `<${name}>`;
  });
  return sanitized
    .replace(/<p>(?:\s|<br>)*<\/p>/gi, "")
    .replace(/<\/p>\s*<p>/gi, "<br>")
    .replace(/(?:<br>\s*){3,}/gi, "<br><br>")
    .trim();
}

export function parseBlogArticle(html: string, expectedId: string): BlogArticle | null {
  if (!/^\d+$/.test(expectedId)) return null;
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? ""; const url = safeBlogUrl(attributeOf(canonical, "href")); if (!url || blogArticleId(url) !== expectedId) return null;
  const titleBlock = html.match(/<h1[^>]*class=["'][^"']*\barticle-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const body = html.match(/<div[^>]*class=["'][^"']*\barticle-body-inner\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? "";
  const dateTag = html.match(/<time[^>]*itemprop=["']datePublished["'][^>]*>/i)?.[0] ?? ""; const title = titleBlock.replace(/<[^>]+>/g, "").trim(); if (!title || !body) return null;
  return { id: expectedId, title: decodeEntities(title), url, description: "", publishedAt: attributeOf(dateTag, "datetime"), category: null, author: null, html: sanitizeBlogArticleHtml(body) };
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
function plainText(value: string): string {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function parseBlogIndex(html: string): BlogFeedItem[] {
  return Array.from(html.matchAll(/<article\b[\s\S]*?<\/article>/gi)).flatMap((match) => {
    const article = match[0];
    const titleBlock = article.match(/<h1[^>]*class=["'][^"']*\barticle-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
    const linkTag = titleBlock.match(/<a\b[^>]*>/i)?.[0] ?? "";
    const url = safeBlogUrl(attributeOf(linkTag, "href"));
    const title = plainText(titleBlock);
    const timeTag = article.match(/<time\b[^>]*itemprop=["']datePublished["'][^>]*>/i)?.[0] ?? "";
    const body = article.match(/<div[^>]*class=["'][^"']*\barticle-body-inner\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    if (!url || !title || !blogArticleId(url)) return [];
    return [{ title, url, description: plainText(body.replace(/<span[^>]*class=["'][^"']*\barticle-continue\b[^"']*["'][^>]*>[\s\S]*$/i, "")), publishedAt: attributeOf(timeTag, "datetime"), category: null, author: null }];
  });
}

export async function getBlogPage(page: number): Promise<BlogFeedItem[]> {
  if (!Number.isInteger(page) || page < 1) return [];
  const response = await fetch(`${BLOG_HOME_URL}?p=${page}`, { headers: { Accept: "text/html;charset=UTF-8" }, next: { revalidate: 15 * 60 } });
  if (!response.ok) throw new Error(`Blog page request failed: ${response.status}`);
  return parseBlogIndex(await response.text());
}
export async function getBlogArticle(id: string): Promise<BlogArticle | null> {
  if (!/^\d+$/.test(id)) return null;
  const response = await fetch(`${BLOG_HOME_URL}archives/${id}.html`, { headers: { Accept: "text/html;charset=UTF-8" }, next: { revalidate: 15 * 60 } });
  if (!response.ok) return null;
  return parseBlogArticle(await response.text(), id);
}
