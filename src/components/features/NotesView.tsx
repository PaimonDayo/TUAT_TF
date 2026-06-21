"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import type {
  AuthorMini,
  NoteScope,
  NoteWithRelations,
} from "@/types";

export function NotesView({
  currentUser,
  notes,
  mine = false,
}: {
  currentUser: AuthorMini;
  notes: NoteWithRelations[];
  /** 旧: フォルダ作成フォーム用。作成導線はFABへ移したため未使用（呼び出し互換のため残置） */
  isAdmin?: boolean;
  mine?: boolean;
}) {
  const [scope, setScope] = useState<NoteScope>("shared");
  const visibleNotes = useMemo(
    () =>
      notes.filter((note) => {
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
          ]}
          value={scope}
          onChange={setScope}
          className="w-full"
        />
      </div>

      <NoteList
        notes={visibleNotes}
        currentUserId={currentUser.id}
        showAuthor={!mine}
      />
    </div>
  );
}

export function NoteList({
  notes,
  currentUserId,
  showAuthor = false,
}: {
  notes: NoteWithRelations[];
  currentUserId: string;
  showAuthor?: boolean;
}) {
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
              <BookOpen size={20} className="mt-0.5 shrink-0 text-accent" />
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
              <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
