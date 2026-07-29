import { notFound, redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { getBlogArticle } from "@/lib/blog-feed";
import { permissionsOf } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/supabase/auth";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

export default async function BlogArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/mypage");
  const { id } = await params;
  const article = await getBlogArticle(id);
  if (!article) notFound();
  const date = new Date(article.publishedAt);
  return <>
    <SubHeader title="ブログ" backHref="/blog" />
    <main className="px-4 pb-8 pt-1 md:px-6"><Card className="overflow-hidden"><article className="px-4 py-5 sm:px-6">
      <header className="border-b border-separator pb-4"><time className="text-caption" dateTime={article.publishedAt}>{Number.isNaN(date.getTime()) ? article.publishedAt : dateFormatter.format(date)}</time><h1 className="mt-1.5 text-[22px] font-bold leading-snug tracking-[-0.02em]">{article.title}</h1></header>
      <div className="blog-article-body" dangerouslySetInnerHTML={{ __html: article.html }} />
    </article></Card></main>
  </>;
}
