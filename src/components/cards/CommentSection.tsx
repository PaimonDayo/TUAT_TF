"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/common/Avatar";
import { CommentLikeButton } from "@/components/cards/CommentLikeButton";
import { Linkify } from "@/components/common/Linkify";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";
import type { CommentAuthor, CommentWithAuthor, TargetType } from "@/types";

type CommentLike = { liked: boolean; count: number };

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
  const newUi = useSystemGlass();
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  // コメントごとのいいね。件数と自分の状態を1回のRPCでまとめて読む。
  const [likeState, setLikeState] = useState<Record<string, CommentLike>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const supabase = createClient();
      const commentsResult = await supabase
        .from("comments")
        .select("*, author:profiles(id, display_name, avatar_url)")
        .eq("target_type", targetType)
        .eq("target_id", targetId)
        .order("created_at", { ascending: true });

      if (!active) return;
      if (commentsResult.error) {
        setError("コメントを読み込めませんでした");
        setLoading(false);
        return;
      }

      const rows: CommentWithAuthor[] = (commentsResult.data ?? []).flatMap((row) => {
        if (row.target_type !== "record" && row.target_type !== "tweet") return [];
        return [{
          ...row,
          target_type: row.target_type as TargetType,
        }];
      });
      setComments(rows);
      onCountChange(rows.length);
      setLoading(false);

      // いいねはコメント本文より後でよいので、表示を待たせない。
      if (rows.length > 0) {
        const { data: likeRows } = await supabase.rpc("get_comment_like_state", {
          comment_ids: rows.map((row) => row.id),
        });
        if (!active) return;
        const next: Record<string, CommentLike> = {};
        for (const row of likeRows ?? [])
          next[row.comment_id] = {
            liked: row.liked_by_me,
            count: Number(row.likes_count),
          };
        setLikeState(next);
      }
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

    const added: CommentWithAuthor = {
      ...data,
      target_type: targetType,
      author: currentUser,
    };
    setComments((items) => {
      const next = [...items, added];
      onCountChange(next.length);
      return next;
    });
    setText("");
    setSaving(false);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: newUi && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }));
  }

  function beginEdit(comment: CommentWithAuthor) {
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
      items.map((item) =>
        item.id === comment.id ? { ...item, ...data } : item,
      ),
    );
    setEditingId(null);
    setEditText("");
    setSaving(false);
  }

  async function remove(comment: CommentWithAuthor) {
    if (!currentUser.canModerateComments && comment.user_id !== currentUser.id) return false;
    setError("");
    try {
      const response = await fetch("/api/comments/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: comment.id, kind: "app" }) });
      const result = await response.json();
      if (!response.ok || !result.ok) { setError("コメントを削除できませんでした。画面を再読み込みして状態を確認してください"); return false; }
      setComments((items) => {
        const next = items.filter((item) => item.id !== comment.id);
        onCountChange(next.length);
        return next;
      });
      return true;
    } catch { setError("削除結果を確認できませんでした。画面を再読み込みして確認してください"); return false; }
  }

  return (
    <div
      data-ui-comments
      className="mt-3 min-w-0 max-w-full overflow-hidden border-t border-separator/70 pt-3"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="max-h-[40vh] max-w-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none space-y-3 pr-0.5">
        {loading ? (
          <div className="space-y-3 py-2">
            {[0, 1].map((item) => (
              <div key={item} className="flex items-center gap-2.5">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <EmptyState title="まだコメントはありません" className="min-h-20 py-4" />
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
                    {(comment.user_id === currentUser.id || currentUser.canModerateComments) && !editing && (
                      <ActionMenu
                        onEdit={comment.user_id === currentUser.id ? () => beginEdit(comment) : undefined}
                        onDelete={() => remove(comment)}
                        deleteTitle="コメントを削除しますか？"
                        deleteDescription="元に戻せません。"
                        triggerLabel="コメントのメニュー"
                        className="-mr-1"
                      />
                    )}
                  </div>

                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        aria-label="コメントを編集"
                        rows={2}
                        maxLength={500}
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        className="max-w-full"
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
                          {saving ? "保存中…" : "保存する"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[14px] whitespace-pre-wrap break-words">
                        <Linkify text={comment.content} />
                      </p>
                      {edited && <p className="text-micro mt-0.5">編集済み</p>}
                      <CommentLikeButton
                        commentId={comment.id}
                        liked={likeState[comment.id]?.liked ?? false}
                        count={likeState[comment.id]?.count ?? 0}
                        onChange={(next) =>
                          setLikeState((state) => ({ ...state, [comment.id]: next }))
                        }
                      />
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

      <div className="mt-3 flex min-w-0 items-end gap-2">
        <Textarea
          aria-label="コメントを入力"
          rows={1}
          maxLength={500}
          placeholder="コメントを入力"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 min-w-0 flex-1 py-2.5"
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

    </div>
  );
}
