import { ChevronRight, Rss } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { blogArticleId, getBlogFeed } from "@/lib/blog-feed";
import { permissionsOf } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/supabase/auth";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

export default async function BlogPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/mypage");
  let items: Awaited<ReturnType<typeof getBlogFeed>> = [];
  let unavailable = false;
  try { items = await getBlogFeed(); } catch (error) { console.error("Failed to load the club blog feed", error); unavailable = true; }
  return <>
    <SubHeader title="ブログ" backHref="/mypage" />
    <main className="space-y-4 px-4 pb-6 pt-1 md:px-6">
      <div><p className="text-headline">東京農工大学陸上競技部ブログ</p><p className="mt-0.5 text-caption text-muted">公式ブログの最新記事</p></div>
      {unavailable ? <Card className="p-4"><EmptyState icon={<Rss size={28} />} title="ブログを読み込めませんでした" description="時間をおいて、もう一度開いてください。" className="min-h-36" /></Card>
      : items.length === 0 ? <Card className="p-4"><EmptyState title="記事がありません" className="min-h-28" /></Card>
      : <div className="space-y-3">{items.map((item) => {
        const id = blogArticleId(item.url); if (!id) return null; const date = new Date(item.publishedAt);
        return <Card key={item.url} className="overflow-hidden"><Link href={`/blog/${id}`} className="block p-4 active:bg-bg">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-micro text-muted"><time dateTime={item.publishedAt}>{Number.isNaN(date.getTime()) ? item.publishedAt : dateFormatter.format(date)}</time>{item.category && <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">{item.category}</span>}</div>
          <h2 className="text-headline leading-snug">{item.title}</h2>{item.description && <p className="mt-2 line-clamp-4 whitespace-pre-line text-caption leading-relaxed text-muted2">{item.description}</p>}
          <span className="mt-3 flex items-center justify-end gap-1 text-caption font-semibold text-accent">続きを読む<ChevronRight size={15} /></span>
        </Link></Card>;
      })}</div>}
    </main>
  </>;
}
