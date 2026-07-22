import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { Linkify } from "@/components/common/Linkify";
import { NoteArticleActions } from "@/components/features/NoteArticleActions";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { getNoteArticleById, getNoteById } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/supabase/auth";

export default async function NoteArticlePage({
  params,
}: {
  params: Promise<{ id: string; articleId: string }>;
}) {
  const { id, articleId } = await params;
  const [profile, note, article] = await Promise.all([
    getCurrentProfile(),
    getNoteById(id),
    getNoteArticleById(id, articleId),
  ]);
  if (!note || !article) notFound();

  const isAdmin = permissionsOf(profile.roles).manageMembers;
  const isSpecifiedEditor =
    note.edit_policy === "specified" &&
    (note.editors ?? []).some((editor) => editor.user_id === profile.id);
  const canEdit =
    note.author_id === profile.id ||
    isAdmin ||
    note.edit_policy === "everyone" ||
    isSpecifiedEditor;
  const currentUser = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    blocks: profile.blocks,
    grade: profile.grade,
  };

  return (
    <>
      <SubHeader
        title={note.title}
        backHref={`/notes/${note.id}`}
        right={
          <NoteArticleActions
            noteId={note.id}
            article={article}
            currentUser={currentUser}
            canEdit={canEdit}
            canShare={note.status === "published"}
          />
        }
      />
      <article className="px-4 pt-1">
        <Card className="space-y-4 p-4">
          <h1 className="text-title">{article.title}</h1>
          <div className="flex items-center gap-2">
            <Avatar
              name={article.author.display_name}
              avatarUrl={article.author.avatar_url}
              blocks={article.author.blocks}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">
                {article.author.display_name}
              </p>
              <p className="text-micro">
                {format(new Date(article.updated_at), "yyyy年M月d日 更新", {
                  locale: ja,
                })}
              </p>
            </div>
          </div>
          <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
            <Linkify text={article.body} />
          </div>
        </Card>
      </article>
    </>
  );
}
