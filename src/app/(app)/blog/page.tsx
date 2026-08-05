import { ChevronLeft, ChevronRight, Rss } from "lucide-react";
import Link from "next/link";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { BLOG_PAGE_SIZE, blogArticleId, getBlogPage } from "@/lib/blog-feed";
import { getCurrentProfile } from "@/lib/supabase/auth";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await getCurrentProfile();
  const requestedPage = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  let items: Awaited<ReturnType<typeof getBlogPage>> = [];
  let hasNext = false;
  let unavailable = false;
  try {
    const pageItems = await getBlogPage(page);
    items = pageItems.slice(0, BLOG_PAGE_SIZE);
    hasNext = pageItems.length > BLOG_PAGE_SIZE;
  } catch (error) {
    console.error("Failed to load the club blog", error);
    unavailable = true;
  }

  return <>
    <SubHeader title="ブログ" backHref="/mypage" forceBackHref />
    <main className="space-y-4 px-4 pb-6 pt-1 md:px-6">
      <div><p className="text-headline">東京農工大学陸上競技部ブログ</p><p className="mt-0.5 text-caption text-muted">公式ブログの記事一覧</p></div>
      {unavailable ? <Card className="p-4"><EmptyState icon={<Rss size={28} />} title="ブログを読み込めませんでした" description="時間をおいて、もう一度開いてください。" className="min-h-36" /></Card>
      : items.length === 0 ? <Card className="p-4"><EmptyState title="まだ記事はありません" className="min-h-28" /></Card>
      : <div className="space-y-3">{items.map((item) => {
        const id = blogArticleId(item.url); if (!id) return null; const date = new Date(item.publishedAt);
        return <Card key={item.url} className="overflow-hidden"><Link href={`/blog/${id}`} className="block p-4 active:bg-bg">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-micro text-muted"><time dateTime={item.publishedAt}>{Number.isNaN(date.getTime()) ? item.publishedAt : dateFormatter.format(date)}</time></div>
          <h2 className="break-words text-headline leading-snug">{item.title}</h2>{item.description && <p className="mt-2 whitespace-pre-wrap break-words text-caption leading-relaxed text-muted2">{item.description}</p>}
          <span className="mt-3 flex items-center justify-end gap-1 text-caption font-semibold text-accent">続きを読む<ChevronRight size={15} /></span>
        </Link></Card>;
      })}</div>}
      {!unavailable && <nav className="grid grid-cols-2 gap-3 pt-1" aria-label="ブログ一覧のページ送り">
        {page > 1 ? <Link href={page === 2 ? "/blog" : `/blog?page=${page - 1}`} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-separator bg-card text-sm font-semibold text-accent"><ChevronLeft size={17} />新しい記事</Link> : <span />}
        {hasNext && <Link href={`/blog?page=${page + 1}`} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-separator bg-card text-sm font-semibold text-accent">過去の記事<ChevronRight size={17} /></Link>}
      </nav>}
    </main>
  </>;
}