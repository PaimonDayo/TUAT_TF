import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { Linkify } from "@/components/common/Linkify";
import { SubHeader } from "@/components/layout/SubHeader";
import { NoteDetailActions } from "@/components/features/NoteDetailActions";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getMembersList, getNoteById, getNotesData } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, note, members, data] = await Promise.all([
    getCurrentProfile(),
    getNoteById(id),
    getMembersList(),
    getNotesData(),
  ]);
  if (!note) notFound();

  const permissions = permissionsOf(profile.roles);
  const isAdmin = permissions.manageMembers;
  const isAuthor = note.author_id === profile.id;
  const isSpecifiedEditor =
    note.edit_policy === "specified" &&
    (note.editors ?? []).some((editor) => editor.user_id === profile.id);
  const canEdit =
    note.scope === "personal"
      ? isAuthor
      : isAuthor || isAdmin || note.edit_policy === "everyone" || isSpecifiedEditor;
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
        backHref="/notes"
        right={
          canEdit || canDelete ? (
            <NoteDetailActions
              note={note}
              currentUser={currentUser}
              members={members}
              themes={data.themes}
              isAdmin={isAdmin}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ) : undefined
        }
      />
      <article className="px-4 pt-1">
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{note.scope === "shared" ? note.theme?.name ?? "共有" : "個人"}</Badge>
            {note.status === "draft" && <Badge>下書き</Badge>}
          </div>
          <h1 className="text-title">{note.title}</h1>
          <div className="flex items-center gap-2">
            <Avatar
              name={note.author.display_name}
              avatarUrl={note.author.avatar_url}
              blocks={note.author.blocks}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">
                {note.author.display_name}
              </p>
              <p className="text-micro">
                {format(new Date(note.updated_at), "yyyy年M月d日 更新", { locale: ja })}
              </p>
            </div>
          </div>
          <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
            <Linkify text={note.body} />
          </div>
        </Card>
      </article>
    </>
  );
}
