"use client";

import { useCallback, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CommentSection } from "@/components/cards/CommentSection";
import { cn } from "@/lib/utils";
import type { CommentAuthor, TargetType } from "@/types";

/** いいね + コメント の操作行 */
export function PostActions({
  targetType,
  targetId,
  initialLikes,
  initialLiked,
  initialComments = 0,
  currentUser,
}: {
  targetType: TargetType;
  targetId: string;
  initialLikes: number;
  initialLiked: boolean;
  initialComments?: number;
  currentUser: CommentAuthor;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [busy, setBusy] = useState(false);
  const [openComments, setOpenComments] = useState(false);
  const [commentsMounted, setCommentsMounted] = useState(false);
  const [commentCount, setCommentCount] = useState(initialComments);
  const updateCommentCount = useCallback((count: number) => setCommentCount(count), []);

  function toggleComments() {
    setCommentsMounted(true);
    setOpenComments((open) => !open);
  }

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
          <span className="inline-block w-5 text-left tabular-nums">{likes > 0 ? likes : ""}</span>
        </button>
        <button
          onClick={toggleComments}
          aria-expanded={openComments}
          className={cn(
            "flex items-center gap-1.5 text-[13px] active:opacity-50",
            openComments ? "text-accent" : "text-muted",
          )}
        >
          <MessageCircle size={18} strokeWidth={2} />
          <span className="inline-block w-5 text-left tabular-nums">{commentCount > 0 ? commentCount : ""}</span>
        </button>
      </div>

      {commentsMounted && (
        <div className={openComments ? "comment-pop" : "hidden"}>
          <CommentSection
            targetType={targetType}
            targetId={targetId}
            currentUser={currentUser}
            onCountChange={updateCommentCount}
          />
        </div>
      )}
    </>
  );
}
