"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Folder } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { FolderRowActions } from "@/components/features/FolderRowActions";
import { ThreadList } from "@/components/features/ThreadList";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import type {
  AuthorMini,
  NoteScope,
  NoteWithRelations,
  ThreadWithAuthor,
} from "@/types";

export type NotesTab = NoteScope | "threads";

/** 共有/個人タブの選択を保持するcookie（タイムラインの簡易表示cookieと同じ方式でSSR復元） */
const SCOPE_COOKIE = "tuat-notes-scope";

export function NotesView({
  currentUser,
  notes,
  threads = [],
  isAdmin = false,
  mine = false,
  initialScope = "shared",
}: {
  currentUser: AuthorMini;
  notes: NoteWithRelations[];
  threads?: ThreadWithAuthor[];
  isAdmin?: boolean;
  mine?: boolean;
  initialScope?: NotesTab;
}) {
  const [scope, setScope] = useState<NotesTab>(initialScope);

  function changeScope(next: NotesTab) {
    setScope(next);
    // ノート詳細から戻ってページが再レンダーされても選択タブが残るようにする
    document.cookie = `${SCOPE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  const visibleNotes = useMemo(
    () =>
      notes.filter((note) => {
        if (note.parent_id) return false; // サブフォルダは親フォルダ内でのみ表示
        if (mine && note.author_id !== currentUser.id) return false;
        if (note.scope !== scope) return false;
        if (!mine && note.status !== "published") return false;
        return true;
      }),
    [currentUser.id, mine, notes, scope],
  );

  return (
    <div className="space-y-4 px-4 pt-1">
      <div className="flex min-h-9 items-center">
        <SegmentedControl
          items={[
            { key: "shared", label: "共有" },
            { key: "personal", label: "個人" },
            { key: "threads", label: "スレッド" },
          ].filter(({ key }) => key !== "threads")}
          value={scope}
          onChange={(key) => changeScope(key as NotesTab)}
          className="w-full"
        />
      </div>

      {scope === "threads" ? (
        <ThreadList threads={threads} currentUserId={currentUser.id} isAdmin={isAdmin} />
      ) : (
        <NoteList
          notes={visibleNotes}
          currentUser={currentUser}
          isAdmin={isAdmin}
          showAuthor={!mine}
        />
      )}
    </div>
  );
}

export function NoteList({
  notes,
  currentUser,
  isAdmin = false,
  showAuthor = false,
}: {
  notes: NoteWithRelations[];
  currentUser: AuthorMini;
  isAdmin?: boolean;
  showAuthor?: boolean;
}) {
  const currentUserId = currentUser.id;
  if (notes.length === 0) {
    return (
      <EmptyState
        title="ノートフォルダがありません"
        description="フォルダを作成すると、その中へ記事を追加できます。"
      />
    );
  }

  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <Link key={note.id} href={`/notes/${note.id}`}>
          <Card className="p-4 active:bg-bg">
            <div className="flex items-start gap-3">
              <Folder size={20} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="min-w-0 flex-1 truncate text-headline">{note.title}</p>
                  {note.status === "draft" && <Badge>下書き</Badge>}
                </div>
                <p className="mt-1 text-caption">
                  {note.articles?.length ?? 0}件の記事
                </p>
                {note.description && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-caption">
                    {note.description}
                  </p>
                )}
                {showAuthor && (
                  <div className="mt-2 flex items-center gap-2">
                    <Avatar
                      name={note.author.display_name}
                      avatarUrl={note.author.avatar_url}
                      blocks={note.author.blocks}
                      size="sm"
                    />
                    <span className="text-micro">
                      {note.author.id === currentUserId
                        ? "自分"
                        : note.author.display_name}
                    </span>
                  </div>
                )}
              </div>
              {note.author_id === currentUserId || isAdmin ? (
                <div
                  className="-mr-2 -mt-1 shrink-0"
                  onClick={(event) => {
                    // 行全体がLinkのため、メニュー操作でフォルダへ遷移しない
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <FolderRowActions note={note} currentUser={currentUser} isAdmin={isAdmin} />
                </div>
              ) : (
                <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" />
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
