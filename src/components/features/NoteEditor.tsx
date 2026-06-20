"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/button";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  AuthorMini,
  NoteEditPolicy,
  NoteScope,
  NoteStatus,
  NoteTheme,
  NoteWithRelations,
} from "@/types";

export function NoteEditorButton({
  currentUser,
  members,
  themes,
  note,
  isAdmin = false,
  initialScope = "shared",
  initialThemeId,
  label = "新しいノート",
  onDone,
}: {
  currentUser: AuthorMini;
  members: AuthorMini[];
  themes: NoteTheme[];
  note?: NoteWithRelations;
  isAdmin?: boolean;
  initialScope?: NoteScope;
  initialThemeId?: string | null;
  label?: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {!note && <Plus size={17} />}
        {label}
      </Button>
      {open && (
        <FormModal
          open
          onOpenChange={setOpen}
          title={note ? "ノートを編集" : "ノートを作成"}
        >
          <NoteEditor
            currentUser={currentUser}
            members={members}
            themes={themes}
            note={note}
            isAdmin={isAdmin}
            initialScope={initialScope}
            initialThemeId={initialThemeId}
            onDone={() => {
              setOpen(false);
              onDone?.();
            }}
          />
        </FormModal>
      )}
    </>
  );
}

export function NoteEditor({
  currentUser,
  members,
  themes: initialThemes,
  note,
  isAdmin,
  initialScope,
  initialThemeId,
  onDone,
}: {
  currentUser: AuthorMini;
  members: AuthorMini[];
  themes: NoteTheme[];
  note?: NoteWithRelations;
  isAdmin: boolean;
  initialScope: NoteScope;
  initialThemeId?: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const ownsNote = !note || note.author_id === currentUser.id;
  const canManagePermissions = ownsNote || isAdmin;
  const [scope, setScope] = useState<NoteScope>(note?.scope ?? initialScope);
  const [themes] = useState(initialThemes);
  const validInitialThemeId = initialThemes.some((theme) => theme.id === initialThemeId)
    ? initialThemeId
    : null;
  const [themeId, setThemeId] = useState(
    note?.theme_id ?? validInitialThemeId ?? initialThemes[0]?.id ?? "",
  );
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [status, setStatus] = useState<NoteStatus>(note?.status ?? "draft");
  const [editPolicy, setEditPolicy] = useState<NoteEditPolicy>(
    note?.edit_policy ?? "author",
  );
  const [editorIds, setEditorIds] = useState(
    note?.editors?.map((editor) => editor.user_id) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleEditor(userId: string) {
    setEditorIds((ids) =>
      ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId],
    );
  }

  async function submit() {
    if (!title.trim() || !body.trim()) {
      setError("タイトルと本文を入力してください");
      return;
    }
    if (scope === "shared" && !themeId) {
      setError("共有ノートのフォルダを選択してください");
      return;
    }
    if (
      scope === "shared" &&
      editPolicy === "specified" &&
      editorIds.length === 0
    ) {
      setError("編集できる部員を1人以上選択してください");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      scope,
      theme_id: scope === "shared" ? themeId : null,
      title: title.trim(),
      body: body.trim(),
      status,
      edit_policy: scope === "shared" ? editPolicy : "author",
    };

    let noteId = note?.id;
    if (note) {
      const updatePayload = canManagePermissions
        ? payload
        : { title: payload.title, body: payload.body, status: payload.status };
      const { error: updateError } = await supabase
        .from("notes")
        .update(updatePayload)
        .eq("id", note.id);
      if (updateError) {
        console.error("Failed to update note", updateError);
        setError("ノートを更新できませんでした");
        setSaving(false);
        return;
      }
    } else {
      const { data, error: insertError } = await supabase
        .from("notes")
        .insert({ ...payload, author_id: currentUser.id })
        .select("id")
        .single();
      if (insertError || !data) {
        console.error("Failed to create note", insertError);
        setError("ノートを保存できませんでした");
        setSaving(false);
        return;
      }
      noteId = data.id as string;
    }

    if (noteId && canManagePermissions) {
      const { error: deleteEditorsError } = await supabase
        .from("note_editors")
        .delete()
        .eq("note_id", noteId);
      if (deleteEditorsError) {
        console.error("Failed to reset note editors", deleteEditorsError);
        setError("編集者の設定を更新できませんでした");
        setSaving(false);
        return;
      }
      if (scope === "shared" && editPolicy === "specified" && editorIds.length > 0) {
        const { error: editorError } = await supabase
          .from("note_editors")
          .insert(editorIds.map((userId) => ({ note_id: noteId, user_id: userId })));
        if (editorError) {
          console.error("Failed to save note editors", editorError);
          setError("編集者の設定を保存できませんでした");
          setSaving(false);
          return;
        }
      }
    }

    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-5 pb-4">
      {(!note || canManagePermissions) && (
        <div>
          <p className="section-label mb-1.5">種類</p>
          <SegmentedControl
            items={[
              { key: "shared", label: "共有" },
              { key: "personal", label: "個人" },
            ]}
            value={scope}
            onChange={(value) => setScope(value)}
          />
        </div>
      )}

      {scope === "shared" && canManagePermissions && (
        <>
          <div>
            <p className="section-label mb-1.5">フォルダ</p>
            <p className="text-micro mb-2">
              共有ノートを整理する場所です。例: 大会、怪我予防、短距離
            </p>
            {themes.length > 0 ? (
              <select
                value={themeId}
                onChange={(event) => setThemeId(event.target.value)}
                className="h-11 w-full rounded-xl border border-separator bg-card px-3 text-[15px] outline-none"
              >
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-xl border border-separator bg-bg p-3 text-caption">
                先に共有フォルダ一覧でフォルダを作成してください。
              </p>
            )}
          </div>

          <div>
            <p className="section-label mb-1.5">編集権限</p>
            <SegmentedControl
              items={[
                { key: "everyone", label: "全員" },
                { key: "specified", label: "指定者" },
                { key: "author", label: "作者のみ" },
              ]}
              value={editPolicy}
              onChange={(value) => setEditPolicy(value)}
            />
          </div>

          {editPolicy === "specified" && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="section-label">編集できる部員</p>
                <span className="text-caption">{editorIds.length}人選択</span>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
                {members
                  .filter((member) => member.id !== currentUser.id)
                  .map((member) => {
                    const active = editorIds.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleEditor(member.id)}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left",
                          active ? "bg-accent/10" : "active:bg-bg",
                        )}
                      >
                        <Avatar
                          name={member.display_name}
                          avatarUrl={member.avatar_url}
                          blocks={member.blocks}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                          {member.display_name}
                        </span>
                        {active && <Check size={18} className="text-accent" />}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <p className="section-label mb-1.5">タイトル</p>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="タイトル"
          maxLength={100}
        />
      </div>

      <div>
        <p className="section-label mb-1.5">本文</p>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="残しておきたい知識や考えを書く"
          rows={14}
        />
      </div>

      <div>
        <p className="section-label mb-1.5">公開状態</p>
        <SegmentedControl
          items={[
            { key: "draft", label: "下書き" },
            { key: "published", label: "公開" },
          ]}
          value={status}
          onChange={(value) => setStatus(value)}
        />
      </div>

      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={saving} onClick={submit}>
        {saving ? "保存中..." : note ? "更新する" : "保存する"}
      </Button>
    </div>
  );
}
