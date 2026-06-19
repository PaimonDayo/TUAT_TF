"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/common/Avatar";
import { Linkify } from "@/components/common/Linkify";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { OwnerActionMenu } from "@/components/ui/owner-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CommentAuthor, CommentWithAuthor, TargetType } from "@/types";

export function CommentSection({
  targetType,
  targetId,
  currentUser,
  onCountChange,
}: {
  targetType: TargetType;
  targetId: string;
  currentUser: CommentAuthor;
  onCountChange: (count: number) => void;
}) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionTarget, setActionTarget] = useState<CommentWithAuthor | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deletingTarget, setDeletingTarget] = useState<CommentWithAuthor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("comments")
        .select("*, author:profiles(id, display_name, avatar_url)")
        .eq("target_type", targetType)
        .eq("target_id", targetId)
        .order("created_at", { ascending: true });

      if (!active) return;
      if (loadError) {
        setError("コメントを読み込めませんでした");
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as unknown as CommentWithAuthor[];
      setComments(rows);
      onCountChange(rows.length);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [onCountChange, targetId, targetType]);

  async function add() {
    const content = text.trim();
    if (!content || saving) return;

    setSaving(true);
    setError("");
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("comments")
      .insert({
        user_id: currentUser.id,
        target_type: targetType,
        target_id: targetId,
        content,
      })
      .select("id, user_id, target_type, target_id, content, created_at, updated_at")
      .single();

    if (insertError || !data) {
      setError("コメントを送信できませんでした");
      setSaving(false);
      return;
    }

    const added = { ...data, author: currentUser } as CommentWithAuthor;
    setComments((items) => {
      const next = [...items, added];
      onCountChange(next.length);
      return next;
    });
    setText("");
    setSaving(false);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  function beginEdit(comment: CommentWithAuthor) {
    setActionTarget(null);
    setEditingId(comment.id);
    setEditText(comment.content);
    setError("");
  }

  async function saveEdit(comment: CommentWithAuthor) {
    const content = editText.trim();
    if (!content || saving) return;

    setSaving(true);
    setError("");
    const supabase = createClient();
    const { data, error: updateError } = await supabase
      .from("comments")
      .update({ content })
      .eq("id", comment.id)
      .eq("user_id", currentUser.id)
      .select("content, updated_at")
      .single();

    if (updateError || !data) {
      setError("コメントを更新できませんでした");
      setSaving(false);
      return;
    }

    setComments((items) =>
      items.map((item) => (item.id === comment.id ? { ...item, ...data } : item)),
    );
    setEditingId(null);
    setEditText("");
    setSaving(false);
  }

  async function remove() {
    if (!deletingTarget || deleting) return;

    setDeleting(true);
    setError("");
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("comments")
      .delete()
      .eq("id", deletingTarget.id)
      .eq("user_id", currentUser.id);

    if (deleteError) {
      setError("コメントを削除できませんでした");
      setDeleting(false);
      return;
    }

    setComments((items) => {
      const next = items.filter((item) => item.id !== deletingTarget.id);
      onCountChange(next.length);
      return next;
    });
    setDeleting(false);
    setDeletingTarget(null);
  }

  return (
    <div className="mt-3 border-t border-separator/70 pt-3">
      <div className="max-h-[40vh] overflow-y-auto space-y-3 pr-0.5">
        {loading ? (
          <p className="text-caption text-center py-5">読み込み中…</p>
        ) : comments.length === 0 ? (
          <p className="text-caption text-center py-5">まだコメントはありません</p>
        ) : (
          comments.map((comment) => {
            const editing = editingId === comment.id;
            const edited = new Date(comment.updated_at).getTime() > new Date(comment.created_at).getTime() + 1000;

            return (
              <div key={comment.id} className="flex gap-2.5">
                <Avatar
                  name={comment.author.display_name}
                  avatarUrl={comment.author.avatar_url}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-7 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {comment.author.display_name || "名無し"}
                    </p>
                    {comment.user_id === currentUser.id && !editing && (
                      <button
                        type="button"
                        onClick={() => setActionTarget(comment)}
                        aria-label="コメントのメニュー"
                        className="h-8 w-8 -mr-1 flex shrink-0 items-center justify-center text-muted active:opacity-50"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    )}
                  </div>

                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        rows={2}
                        maxLength={200}
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                        >
                          キャンセル
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={saving || !editText.trim()}
                          onClick={() => saveEdit(comment)}
                        >
                          {saving ? "保存中…" : "保存"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[14px] whitespace-pre-wrap break-words">
                        <Linkify text={comment.content} />
                      </p>
                      {edited && <p className="text-micro mt-0.5">編集済み</p>}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          rows={1}
          maxLength={200}
          placeholder="コメントを追加…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 py-2.5"
        />
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={saving || !text.trim()}
          className="h-11 px-4"
        >
          {saving ? "送信中…" : "送信"}
        </Button>
      </div>

      <Sheet open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <SheetContent>
          {actionTarget && (
            <OwnerActionMenu
              onEdit={() => beginEdit(actionTarget)}
              onDelete={() => {
                setDeletingTarget(actionTarget);
                setActionTarget(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deletingTarget}
        onOpenChange={(open) => !open && setDeletingTarget(null)}
        title="コメントを削除しますか？"
        description="削除したコメントは元に戻せません。"
        busy={deleting}
        onConfirm={remove}
      />
    </div>
  );
}
