"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CommentSection } from "@/components/cards/CommentSection";
import { LikersSheet } from "@/components/cards/LikersSheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CommentAuthor, TargetType } from "@/types";

type InteractionState = {
  liked: boolean;
  likes: number;
  commentCount: number;
  busy: boolean;
};

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
  const queryClient = useQueryClient();
  const interactionKey = ["social-like", currentUser.id, targetType, targetId] as const;
  const { data: interaction } = useQuery({
    queryKey: interactionKey,
    queryFn: async () => ({ liked: initialLiked, likes: initialLikes, commentCount: initialComments, busy: false }),
    initialData: { liked: initialLiked, likes: initialLikes, commentCount: initialComments, busy: false },
    staleTime: Infinity,
    enabled: false,
  });
  const { liked, likes, commentCount, busy } = interaction;
  const [openComments, setOpenComments] = useState(false);
  const [commentsMounted, setCommentsMounted] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const { showToast } = useToast();
  const updateCommentCount = useCallback((count: number) => {
    queryClient.setQueryData(
      ["social-like", currentUser.id, targetType, targetId],
      (previous: InteractionState | undefined) => ({
        ...(previous ?? {
          liked: initialLiked,
          likes: initialLikes,
          commentCount: initialComments,
          busy: false,
        }),
        commentCount: count,
      }),
    );
  }, [
    currentUser.id,
    initialComments,
    initialLiked,
    initialLikes,
    queryClient,
    targetId,
    targetType,
  ]);

  // いいねボタンの長押しで「いいねした人」シートを開く
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function startPress() {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setLikersOpen(true);
    }, 450);
  }
  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function handleLikeClick() {
    // 長押しでシートを開いた場合は通常のいいねトグルを行わない
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    toggleLike();
  }

  function toggleComments() {
    setCommentsMounted(true);
    setOpenComments((open) => !open);
  }

  async function toggleLike() {
    if (busy) return;
    const previous = { ...interaction, busy: false };
    const next = !liked;
    const optimistic = {
      ...interaction,
      liked: next,
      likes: Math.max(0, likes + (next ? 1 : -1)),
      busy: true,
    };
    queryClient.setQueryData(interactionKey, optimistic);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      queryClient.setQueryData(interactionKey, previous);
      showToast("ログイン状態を確認できませんでした");
      return;
    }

    const result = next
      ? await supabase
          .from("likes")
          .upsert(
            { user_id: user.id, target_type: targetType, target_id: targetId },
            { onConflict: "user_id,target_type,target_id" },
          )
          .select("target_id")
          .single()
      : await supabase
          .from("likes")
          .delete()
          .eq("user_id", user.id)
          .eq("target_type", targetType)
          .eq("target_id", targetId)
          .select("target_id");

    const deleteFailed = !next && (!Array.isArray(result.data) || result.data.length !== 1);
    if (result.error || deleteFailed) {
      queryClient.setQueryData(interactionKey, previous);
      showToast(next ? "いいねできませんでした" : "いいねを解除できませんでした");
      return;
    }

    queryClient.setQueryData(interactionKey, { ...optimistic, busy: false });
  }
  return (
    <>
      <div className="flex select-none items-center gap-5 pt-1">
        <button
          onClick={handleLikeClick}
          onPointerDown={(event) => {
            event.preventDefault();
            startPress();
          }}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "flex select-none touch-manipulation items-center gap-1.5 text-[13px] active:opacity-50 transition-active [-webkit-touch-callout:none]",
            liked ? "text-danger" : "text-muted",
          )}
        >
          <Heart size={18} fill={liked ? "#ff3b30" : "none"} strokeWidth={2} />
          {/* 常に数字を描画し0は透明にする＝箱が一定でガクつかない */}
          <span className={cn("inline-block w-5 text-left tabular-nums", likes === 0 && "opacity-0")}>
            {likes}
          </span>
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
          <span className={cn("inline-block w-5 text-left tabular-nums", commentCount === 0 && "opacity-0")}>
            {commentCount}
          </span>
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

      <LikersSheet
        targetType={targetType}
        targetId={targetId}
        open={likersOpen}
        onOpenChange={setLikersOpen}
      />
    </>
  );
}
