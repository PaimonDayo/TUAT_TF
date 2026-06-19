"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, FileText } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { NoteEditorButton } from "@/components/features/NoteEditor";
import { ActionMenu } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import type {
  AuthorMini,
  NoteScope,
  NoteTheme,
  NoteWithRelations,
} from "@/types";

const UNASSIGNED_THEME = "__unassigned__";

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
  const router = useRouter();
  const [scope, setScope] = useState<NoteScope>("shared");
  const [themeId, setThemeId] = useState<string | null>(null);
  const [themeForm, setThemeForm] = useState<NoteTheme | "new" | null>(null);
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
  const themeNotes = visibleNotes.filter((note) =>
    themeId === UNASSIGNED_THEME ? note.theme_id === null : note.theme_id === themeId,
  );
  const unassignedNotes = visibleNotes.filter((note) => note.theme_id === null);

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

      <div className="flex justify-end gap-2">
        {scope === "shared" && !themeId && (
          <Button type="button" variant="outline" onClick={() => setThemeForm("new")}>
            テーマ追加
          </Button>
        )}
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
                <Card key={theme.id} className="flex items-center gap-1 p-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left active:bg-bg"
                    onClick={() => setThemeId(theme.id)}
                  >
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
                  </button>
                  {isAdmin && (
                    <ActionMenu
                      onEdit={() => setThemeForm(theme)}
                      onDelete={async () => {
                        const supabase = createClient();
                        const { error } = await supabase
                          .from("note_themes")
                          .delete()
                          .eq("id", theme.id);
                        if (error) return false;
                        setThemeId(null);
                        router.refresh();
                        return true;
                      }}
                      deleteTitle="テーマを削除しますか？"
                      deleteDescription="記事は削除されず、テーマ未設定になります。"
                    />
                  )}
                </Card>
              );
            })
          )}
          {unassignedNotes.length > 0 && (
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => setThemeId(UNASSIGNED_THEME)}
            >
              <Card className="flex items-center gap-3 p-4 active:bg-bg">
                <BookOpen size={20} className="shrink-0 text-muted2" />
                <p className="min-w-0 flex-1 text-headline">テーマ未設定</p>
                <Badge>{unassignedNotes.length}件</Badge>
                <ChevronRight size={18} className="text-muted" />
              </Card>
            </button>
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
          <h2 className="text-title">
            {themeId === UNASSIGNED_THEME
              ? "テーマ未設定"
              : selectedTheme?.name ?? "共有ノート"}
          </h2>
          <NoteList notes={themeNotes} currentUserId={currentUser.id} />
        </section>
      )}

      {scope === "personal" && (
        <NoteList notes={visibleNotes} currentUserId={currentUser.id} showAuthor />
      )}

      {themeForm && (
        <FormModal
          open
          onOpenChange={(open) => !open && setThemeForm(null)}
          title={themeForm === "new" ? "テーマを追加" : "テーマを編集"}
        >
          <ThemeForm
            currentUserId={currentUser.id}
            theme={themeForm === "new" ? undefined : themeForm}
            onDone={() => {
              setThemeForm(null);
              router.refresh();
            }}
          />
        </FormModal>
      )}
    </div>
  );
}

function ThemeForm({
  currentUserId,
  theme,
  onDone,
}: {
  currentUserId: string;
  theme?: NoteTheme;
  onDone: () => void;
}) {
  const [name, setName] = useState(theme?.name ?? "");
  const [description, setDescription] = useState(theme?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("テーマ名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
    };
    const { error: saveError } = theme
      ? await supabase.from("note_themes").update(payload).eq("id", theme.id)
      : await supabase
          .from("note_themes")
          .insert({ ...payload, created_by: currentUserId });
    if (saveError) {
      setError("テーマを保存できませんでした");
      setSaving(false);
      return;
    }
    onDone();
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">テーマ名</p>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
      </div>
      <div>
        <p className="section-label mb-1.5">説明</p>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
        />
      </div>
      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={saving} onClick={submit}>
        {saving ? "保存中..." : "保存する"}
      </Button>
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
