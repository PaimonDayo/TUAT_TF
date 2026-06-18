"use client";

import { useEffect, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "@/components/common/Avatar";
import { Linkify } from "@/components/common/Linkify";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommentWithAuthor, TargetType } from "@/types";

/** いいね + コメント の操作行 */
export function PostActions({
  targetType,
  targetId,
  initialLikes,
  initialLiked,
  initialComments = 0,
}: {
  targetType: TargetType;
  targetId: string;
  initialLikes: number;
  initialLiked: boolean;
  initialComments?: number;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [busy, setBusy] = useState(false);
  const [openComments, setOpenComments] = useState(false);
  const [commentCount, setCommentCount] = useState(initialComments);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    if (next) {
      await supabase
        .from("likes")
        .insert({ user_id: user.id, target_type: targetType, target_id: targetId });
    } else {
      await supabase
        .from("likes")
        .delete()
        .eq("user_id", user.id)
        .eq("target_type", targetType)
        .eq("target_id", targetId);
    }
    setBusy(false);
  }

  return (
    <>
      <div className="flex items-center gap-5 pt-1">
        <button
          onClick={toggleLike}
          className={cn(
            "flex items-center gap-1.5 text-[13px] active:opacity-50 transition-active",
            liked ? "text-danger" : "text-muted",
          )}
        >
          <Heart size={18} fill={liked ? "#ff3b30" : "none"} strokeWidth={2} />
          <span className="tabular-nums text-left min-w-[12px]">{likes > 0 ? likes : ""}</span>
        </button>
        <button
          onClick={() => setOpenComments(true)}
          className="flex items-center gap-1.5 text-[13px] text-muted active:opacity-50"
        >
          <MessageCircle size={18} strokeWidth={2} />
          <span className="tabular-nums text-left min-w-[12px]">{commentCount > 0 ? commentCount : ""}</span>
        </button>
      </div>

      <Sheet open={openComments} onOpenChange={setOpenComments}>
        <SheetContent title="コメント" autoFocus={false}>
          <CommentList
            targetType={targetType}
            targetId={targetId}
            onCountChange={setCommentCount}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function CommentList({
  targetType,
  targetId,
  onCountChange,
}: {
  targetType: TargetType;
  targetId: string;
  onCountChange: (n: number) => void;
}) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("comments")
      .select("*, author:profiles(id, display_name, avatar_url)")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as unknown as CommentWithAuthor[];
    setComments(rows);
    onCountChange(rows.length);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    const content = text.trim();
    if (!content) return;
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    await supabase
      .from("comments")
      .insert({ user_id: user.id, target_type: targetType, target_id: targetId, content });
    setText("");
    setSaving(false);
    await load();
  }

  return (
    <div className="pb-4">
      <div className="max-h-[40vh] overflow-y-auto space-y-3 mb-3">
        {loading ? (
          <p className="text-caption text-center py-6">読み込み中…</p>
        ) : comments.length === 0 ? (
          <p className="text-caption text-center py-6">まだコメントはありません</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.author.display_name} avatarUrl={c.author.avatar_url} size="sm" />
              <div className="flex-1">
                <p className="text-[13px] font-semibold">{c.author.display_name}</p>
                <p className="text-[14px] whitespace-pre-wrap break-words">
                  <Linkify text={c.content} />
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          rows={1}
          maxLength={200}
          placeholder="コメントを追加…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-11 py-2.5"
        />
        <Button size="sm" onClick={add} disabled={saving || !text.trim()} className="h-11 px-4">
          送信
        </Button>
      </div>
    </div>
  );
}
