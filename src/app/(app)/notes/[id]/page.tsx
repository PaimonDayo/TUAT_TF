import { notFound } from "next/navigation";
import { Avatar } from "@/components/common/Avatar";
import { Linkify } from "@/components/common/Linkify";
import { NoteArticleList } from "@/components/features/NoteArticleList";
import { NoteDetailActions } from "@/components/features/NoteDetailActions";
import { SubHeader } from "@/components/layout/SubHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { NoteList } from "@/components/features/NotesView";
import { ThreadList } from "@/components/features/ThreadList";
import {
  getChildNotes,
  getMembersList,
  getNoteAncestors,
  getNoteArticles,
  getNoteById,
  getThreadsByFolder,
} from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/supabase/auth";

export default async function NoteFolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, note, members, articles, childNotes, threads] = await Promise.all([
    getCurrentProfile(),
    getNoteById(id),
    getMembersList(),
    getNoteArticles(id),
    getChildNotes(id),
    getThreadsByFolder(id),
  ]);
  if (!note) notFound();
  const ancestors = await getNoteAncestors(note);

  const isAdmin = permissionsOf(profile.roles).manageMembers;
  const isAuthor = note.author_id === profile.id;
  const isSpecifiedEditor =
    note.edit_policy === "specified" &&
    (note.editors ?? []).some((editor) => editor.user_id === profile.id);
  const canEdit =
    isAuthor || isAdmin || note.edit_policy === "everyone" || isSpecifiedEditor;
  const canManageFolder = isAuthor || isAdmin;
  const canDelete = isAuthor || isAdmin;
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
        title="ノート"
        backHref={ancestors.length > 0 ? `/notes/${ancestors[ancestors.length - 1].id}` : "/notes"}
        right={
          canManageFolder || canDelete ? (
            <NoteDetailActions
              note={note}
              currentUser={currentUser}
              members={members}
              isAdmin={isAdmin}
              canEdit={canManageFolder}
              canDelete={canDelete}
            />
          ) : undefined
        }
      />
      <div className="space-y-4 px-4 pt-1">
        {ancestors.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-caption">
            <Link href="/notes" className="text-accent active:opacity-60">ノート</Link>
            {ancestors.map((ancestor) => (
              <span key={ancestor.id} className="flex items-center gap-1">
                <span className="text-muted2">/</span>
                <Link href={`/notes/${ancestor.id}`} className="text-accent active:opacity-60">
                  {ancestor.title}
                </Link>
              </span>
            ))}
            <span className="text-muted2">/</span>
            <span className="text-muted2">{note.title}</span>
          </p>
        )}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{note.scope === "shared" ? "共有" : "個人作成"}</Badge>
            {note.status === "draft" && <Badge>下書き</Badge>}
          </div>
          <h1 className="text-title">{note.title}</h1>
          {note.description && (
            <div className="whitespace-pre-wrap text-body text-muted2">
              <Linkify text={note.description} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Avatar
              name={note.author.display_name}
              avatarUrl={note.author.avatar_url}
              blocks={note.author.blocks}
              size="sm"
            />
            <span className="text-caption">{note.author.display_name}</span>
          </div>
        </section>

        {childNotes.length > 0 && (
          <section className="space-y-2">
            <p className="section-label">サブフォルダ</p>
            <NoteList notes={childNotes} currentUser={currentUser} isAdmin={isAdmin} showAuthor={false} />
          </section>
        )}

        <section className="space-y-2">
          <p className="section-label">記事</p>
          {articles.length === 0 ? (
            <EmptyState
              title="記事がありません"
              description={
                canEdit ? "右下のボタンから最初の記事を追加できます。" : undefined
              }
            />
          ) : (
            <NoteArticleList
              noteId={note.id}
              articles={articles}
              canEdit={canEdit}
              currentUser={currentUser}
            />
          )}
        </section>
        <section className="space-y-2">
          <p className="section-label">{"\u30b9\u30ec\u30c3\u30c9"}</p>
          <ThreadList threads={threads} currentUserId={profile.id} isAdmin={isAdmin} canPin={isAdmin} />
        </section>
      </div>
    </>
  );
}
