"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, FileText } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { NoteEditorButton } from "@/components/features/NoteEditor";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import type {
  AuthorMini,
  NoteScope,
  NoteTheme,
  NoteWithRelations,
} from "@/types";

export function NotesView({
  currentUser,
  members,
  themes,
  notes,
  isAdmin,
  mine = false,
}: {
  currentUser: AuthorMini;
  members: AuthorMini[];
  themes: NoteTheme[];
  notes: NoteWithRelations[];
  isAdmin: boolean;
  mine?: boolean;
}) {
  const [scope, setScope] = useState<NoteScope>("shared");
  const [themeId, setThemeId] = useState<string | null>(null);
  const visibleNotes = useMemo(
    () =>
      notes.filter((note) => {
        if (mine && note.author_id !== currentUser.id) return false;
        if (note.scope !== scope) return false;
        if (!mine && scope === "personal" && note.status !== "published") return false;
        return true;
      }),
    [currentUser.id, mine, notes, scope],
  );

  const selectedTheme = themes.find((theme) => theme.id === themeId);
  const themeNotes = visibleNotes.filter((note) => note.theme_id === themeId);

  return (
    <div className="px-4 space-y-4 pt-1">
      <SegmentedControl
        items={[
          { key: "shared", label: "共有" },
          { key: "personal", label: "個人" },
        ]}
        value={scope}
        onChange={(value) => {
          setScope(value);
          setThemeId(null);
        }}
      />

      <div className="flex justify-end">
        <NoteEditorButton
          currentUser={currentUser}
          members={members}
          themes={themes}
          isAdmin={isAdmin}
          initialScope={scope}
        />
      </div>

      {scope === "shared" && !themeId && (
        <div className="space-y-2">
          {themes.length === 0 ? (
            <EmptyState
              title="共有テーマがありません"
              description="新しいノートの作成画面からテーマを追加できます。"
            />
          ) : (
            themes.map((theme) => {
              const count = visibleNotes.filter((note) => note.theme_id === theme.id).length;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className="block w-full text-left"
                  onClick={() => setThemeId(theme.id)}
                >
                  <Card className="flex items-center gap-3 p-4 active:bg-bg">
                    <BookOpen size={20} className="shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="text-headline">{theme.name}</p>
                      {theme.description && (
                        <p className="mt-0.5 line-clamp-2 text-caption">
                          {theme.description}
                        </p>
                      )}
                    </div>
                    <Badge>{count}件</Badge>
                    <ChevronRight size={18} className="text-muted" />
                  </Card>
                </button>
              );
            })
          )}
        </div>
      )}

      {scope === "shared" && themeId && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setThemeId(null)}
            className="text-[13px] font-medium text-accent"
          >
            共有テーマに戻る
          </button>
          <h2 className="text-title">{selectedTheme?.name ?? "共有ノート"}</h2>
          <NoteList notes={themeNotes} currentUserId={currentUser.id} />
        </section>
      )}

      {scope === "personal" && (
        <NoteList notes={visibleNotes} currentUserId={currentUser.id} showAuthor />
      )}
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
    return <EmptyState title="ノートがありません" />;
  }

  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <Link key={note.id} href={`/notes/${note.id}`}>
          <Card className="p-4 active:bg-bg">
            <div className="flex items-start gap-3">
              <FileText size={19} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-headline">{note.title}</p>
                  {note.status === "draft" && <Badge>下書き</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-caption">{note.body}</p>
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
