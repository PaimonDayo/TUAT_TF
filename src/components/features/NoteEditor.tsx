"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented";
import { createClient } from "@/lib/supabase/client";
import { PersonPicker } from "@/components/features/PersonPicker";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { cn } from "@/lib/utils";
import type {
  AuthorMini,
  NoteEditPolicy,
  NoteScope,
  NoteStatus,
  NoteWithRelations,
} from "@/types";

export function NoteEditorButton({
  currentUser,
  members,
  note,
  isAdmin = false,
  initialScope = "shared",
  label = "新しいフォルダ",
  onDone,
}: {
  currentUser: AuthorMini;
  members: AuthorMini[];
  note?: NoteWithRelations;
  isAdmin?: boolean;
  initialScope?: NoteScope;
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
          title={note ? "フォルダ設定を編集" : "ノートフォルダを作成"}
        >
          <NoteEditor
            currentUser={currentUser}
            members={members}
            note={note}
            isAdmin={isAdmin}
            initialScope={initialScope}
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
  note,
  isAdmin,
  initialScope,
  parentId,
  onDone,
}: {
  currentUser: AuthorMini;
  members: AuthorMini[];
  note?: NoteWithRelations;
  isAdmin: boolean;
  initialScope: NoteScope;
  /** サブフォルダとして新規作成する場合の親フォルダID（編集時は無視） */
  parentId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const ownsNote = !note || note.author_id === currentUser.id;
  const canManagePermissions = ownsNote || isAdmin;
  const [scope, setScope] = useState<NoteScope>(note?.scope ?? initialScope);
  const [title, setTitle] = useState(note?.title ?? "");
  const [description, setDescription] = useState(note?.description ?? "");
  const [status, setStatus] = useState<NoteStatus>(note?.status ?? "draft");
  const [editPolicy, setEditPolicy] = useState<NoteEditPolicy>(
    note?.edit_policy ?? "author",
  );
  const [editorIds, setEditorIds] = useState(
    note?.editors?.map((editor) => editor.user_id) ?? [],
  );
  const [saving, setSaving] = useState(false);
  // 場所（親フォルダ）の移動（タスク17-e）。編集時＋管理可の場合のみ使用。
  const [parentIdValue, setParentIdValue] = useState<string | null>(note?.parent_id ?? parentId ?? null);
  const [folderOptions, setFolderOptions] = useState<
    { id: string; title: string; parent_id: string | null; scope: NoteScope }[] | null
  >(null);

  useEffect(() => {
    // 移動UIは既存フォルダの編集時のみ（新規作成はFAB/親から場所が決まる）
    if (!note || !canManagePermissions) return;
    let active = true;
    void createClient()
      .from("notes")
      .select("id, title, parent_id, scope")
      .then(({ data }) => {
        if (active) {
          setFolderOptions(
            (data ?? []) as { id: string; title: string; parent_id: string | null; scope: NoteScope }[],
          );
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 移動先候補: 同scope・自分自身と子孫は除外（循環禁止）・移動後もツリー全体が深さ3以内
  const moveTargets = (() => {
    if (!note || !folderOptions) return null;
    const byParent = new Map<string | null, string[]>();
    for (const f of folderOptions) {
      const arr = byParent.get(f.parent_id) ?? [];
      arr.push(f.id);
      byParent.set(f.parent_id, arr);
    }
    // 自分配下の子孫集合と、自分のサブツリーの深さ
    const descendants = new Set<string>();
    let subtreeDepth = 1;
    const walk = (id: string, level: number) => {
      subtreeDepth = Math.max(subtreeDepth, level);
      for (const child of byParent.get(id) ?? []) {
        descendants.add(child);
        walk(child, level + 1);
      }
    };
    walk(note.id, 1);
    const depthOf = (id: string): number => {
      let d = 1;
      let cur = folderOptions.find((f) => f.id === id);
      while (cur?.parent_id && d < 5) {
        d++;
        cur = folderOptions.find((f) => f.id === cur!.parent_id);
      }
      return d;
    };
    return folderOptions
      .filter(
        (f) =>
          f.id !== note.id &&
          !descendants.has(f.id) &&
          f.scope === scope &&
          depthOf(f.id) + subtreeDepth <= 3,
      )
      .map((f) => ({ ...f, depth: depthOf(f.id) }))
      .sort((a, b) => a.title.localeCompare(b.title, "ja"));
  })();
  const [error, setError] = useState<string | null>(null);


  async function submit() {
    if (!title.trim()) {
      setError("フォルダ名を入力してください");
      return;
    }
    if (
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
      theme_id: null,
      title: title.trim(),
      description: description.trim() || null,
      status,
      edit_policy: editPolicy,
      parent_id: parentIdValue,
    };

    let noteId = note?.id;
    if (note) {
      const updatePayload = canManagePermissions
        ? payload
        : { title: payload.title, status: payload.status };
      const result = await safeUpdate(supabase, "notes", updatePayload, {
        id: note.id,
      });
      if (!result.ok) {
        setError(safeUpdateMessage(result.reason));
        setSaving(false);
        return;
      }
    } else {
      const { data, error: insertError } = await supabase
        .from("notes")
        .insert({ ...payload, body: "", author_id: currentUser.id, parent_id: parentId ?? null })
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
      if (editPolicy === "specified" && editorIds.length > 0) {
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
              { key: "personal", label: "個人作成" },
            ]}
            value={scope}
            onChange={(value) => {
              setScope(value);
              // 種類を切り替えたら移動先は一旦ルートへ（別scopeの親に残さない）
              if (note) setParentIdValue(null);
            }}
          />          {scope === "personal" && (
            <p className="mt-1.5 text-micro text-muted2">
              個人作成でも「公開」にすると、プロフィール経由で全部員が閲覧できます。
            </p>
          )}
        </div>
      )}

      {note && canManagePermissions && moveTargets && (
        <div>
          <p className="section-label mb-1.5">場所</p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
            {[{ id: null as string | null, title: "ルート（ノート一覧の直下）", depth: 0 }, ...moveTargets].map(
              (target) => {
                const active = parentIdValue === target.id;
                return (
                  <button
                    key={target.id ?? "root"}
                    type="button"
                    onClick={() => setParentIdValue(target.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left",
                      active ? "bg-accent/10" : "active:bg-bg",
                    )}
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-[14px] font-medium"
                      style={{ paddingLeft: `${target.depth * 14}px` }}
                    >
                      {target.title}
                    </span>
                    {active && <Check size={18} className="text-accent" />}
                  </button>
                );
              },
            )}
          </div>
        </div>
      )}

      {canManagePermissions && (
        <>
          <div>
            <p className="section-label mb-1.5">記事を追加・編集できる人</p>
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
            <PersonPicker people={members} value={editorIds} onChange={setEditorIds} label="編集できる部員" excludeIds={[currentUser.id]} />
          )}
        </>
      )}

      <div>
        <p className="section-label mb-1.5">フォルダ名</p>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例: 大会準備、怪我予防、今季の振り返り"
          maxLength={100}
        />
      </div>

      <div>
        <p className="section-label mb-1.5">説明（任意）</p>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="このフォルダにまとめる内容"
          rows={3}
          maxLength={300}
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
      <FormModalFooter>
        <Button size="lg" disabled={saving} onClick={submit}>
          {saving ? "保存中..." : note ? "更新する" : "保存する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
