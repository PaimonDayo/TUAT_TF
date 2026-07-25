"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CommentSection } from "@/components/cards/CommentSection";
import { LikersSheet } from "@/components/cards/LikersSheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CommentAuthor, FeedItem, TargetType } from "@/types";

type InteractionState = {
  liked: boolean;
  likes: number;
  commentCount: number;
  busy: boolean;
};
type TimelineCache = {
  pages: FeedItem[][];
  pageParams: unknown[];
};

function clearNativeSelection() {
  window.getSelection()?.removeAllRanges();
}

/** いいね + コメント の操作行 */
export function PostActions({
  targetType,
  targetId,
  initialLikes,
  initialLiked,
  initialComments = 0,
  currentUser,
  commentsExpanded = false,
}: {
  targetType: TargetType;
  targetId: string;
  initialLikes: number;
  initialLiked: boolean;
  initialComments?: number;
  currentUser: CommentAuthor;
  commentsExpanded?: boolean;
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
  const mutationBusy = useRef(false);


  const [openComments, setOpenComments] = useState(false);
  const commentsVisible = commentsExpanded || openComments;
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

  function updateTimelineLikeState(nextLiked: boolean, nextLikes: number) {
    queryClient.setQueryData(
      ["timeline", currentUser.id],
      (data: TimelineCache | undefined): TimelineCache | undefined => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) =>
            page.map((item) =>
              item.kind === targetType && item.id === targetId
                ? { ...item, liked_by_me: nextLiked, likes_count: nextLikes }
                : item,
            ),
          ),
        };
      },
    );
  }

  // いいねボタンの長押しで「いいねした人」シートを開く
  const actionsRef = useRef<HTMLDivElement>(null);
  const likeButtonRef = useRef<HTMLButtonElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const touchMoved = useRef(false);
  const touchOrigin = useRef({ x: 0, y: 0 });
  const lastTouchEndAt = useRef(0);
  const toggleLikeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const actions = actionsRef.current;
    if (!actions) return;

    const preventNativeSelection = (event: Event) => {
      event.preventDefault();
      clearNativeSelection();
    };
    actions.addEventListener("selectstart", preventNativeSelection);
    actions.addEventListener("contextmenu", preventNativeSelection);
    actions.addEventListener("dragstart", preventNativeSelection);
    return () => {
      actions.removeEventListener("selectstart", preventNativeSelection);
      actions.removeEventListener("contextmenu", preventNativeSelection);
      actions.removeEventListener("dragstart", preventNativeSelection);
      document.removeEventListener("selectionchange", clearNativeSelection);
    };
  }, []);

  useEffect(() => {
    const button = likeButtonRef.current;
    if (!button) return;

    // Safari requires a native non-passive listener to suppress its selection callout.
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      event.preventDefault();
      touchMoved.current = false;
      touchOrigin.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
      startPress();
    };
    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (!touch) return;
      if (
        Math.abs(touch.clientX - touchOrigin.current.x) > 10 ||
        Math.abs(touch.clientY - touchOrigin.current.y) > 10
      ) {
        touchMoved.current = true;
        cancelPress();
      }
    };
    const handleTouchEnd = (event: TouchEvent) => {
      event.preventDefault();
      const wasLongPress = longPressed.current;
      const wasMoved = touchMoved.current;
      lastTouchEndAt.current = Date.now();
      cancelPress();
      if (!wasLongPress && !wasMoved) toggleLikeRef.current();
      longPressed.current = false;
    };
    const handleTouchCancel = (event: TouchEvent) => {
      event.preventDefault();
      touchMoved.current = true;
      cancelPress();
      longPressed.current = false;
    };

    button.addEventListener("touchstart", handleTouchStart, { passive: false });
    button.addEventListener("touchmove", handleTouchMove, { passive: false });
    button.addEventListener("touchend", handleTouchEnd, { passive: false });
    button.addEventListener("touchcancel", handleTouchCancel, { passive: false });
    return () => {
      button.removeEventListener("touchstart", handleTouchStart);
      button.removeEventListener("touchmove", handleTouchMove);
      button.removeEventListener("touchend", handleTouchEnd);
      button.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, []);
  function startPress() {
    longPressed.current = false;
    clearNativeSelection();
    document.addEventListener("selectionchange", clearNativeSelection);
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      clearNativeSelection();
      document.removeEventListener("selectionchange", clearNativeSelection);
      setLikersOpen(true);
    }, 450);
  }
  function cancelPress() {
    document.removeEventListener("selectionchange", clearNativeSelection);
    clearNativeSelection();
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
    if (commentsExpanded) return;
    setCommentsMounted(true);
    setOpenComments((open) => !open);
  }

  async function toggleLike() {
    if (busy || mutationBusy.current) return;
    mutationBusy.current = true;
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
    updateTimelineLikeState(next, optimistic.likes);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      queryClient.setQueryData(interactionKey, previous);
      showToast("ログイン状態を確認できませんでした");
      updateTimelineLikeState(previous.liked, previous.likes);
      mutationBusy.current = false;
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
      updateTimelineLikeState(previous.liked, previous.likes);
      mutationBusy.current = false;
      return;
    }

    const { count, error: countError } = await supabase
      .from("likes")
      .select("id", { count: "exact", head: true })
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    const confirmedLikes = countError || count == null ? optimistic.likes : count;
    const confirmed = {
      ...optimistic,
      likes: confirmedLikes,
      busy: false,
    };
    queryClient.setQueryData(interactionKey, confirmed);
    updateTimelineLikeState(next, confirmedLikes);
    mutationBusy.current = false;
  }
  useEffect(() => {
    toggleLikeRef.current = toggleLike;
  });

  return (
    <>
      <div
        ref={actionsRef}
        className="flex select-none items-center gap-5 pt-1 [-webkit-touch-callout:none] [-webkit-user-select:none]"
      >
        <button
          ref={likeButtonRef}
          type="button"
          aria-label={
            liked
              ? `\u3044\u3044\u306d\u3092\u89e3\u9664\u3001\u73fe\u5728${likes}\u4ef6`
              : `\u3044\u3044\u306d\u3001\u73fe\u5728${likes}\u4ef6`
          }
          onClick={(event) => {
            if (event.detail > 0 && Date.now() - lastTouchEndAt.current < 700) return;
            handleLikeClick();
          }}
          onPointerDown={(event) => {
            if (event.pointerType === "touch") return;
            event.preventDefault();
            startPress();
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch") cancelPress();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") cancelPress();
          }}
          onPointerCancel={(event) => {
            if (event.pointerType !== "touch") cancelPress();
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "no-native-callout flex touch-none select-none items-center gap-1.5 text-[13px] active:opacity-50 transition-active",
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
          aria-expanded={commentsVisible}
          className={cn(
            "flex items-center gap-1.5 text-[13px] active:opacity-50",
            commentsVisible ? "text-accent" : "text-muted",
          )}
        >
          <MessageCircle size={18} strokeWidth={2} />
          <span className={cn("inline-block w-5 text-left tabular-nums", commentCount === 0 && "opacity-0")}>
            {commentCount}
          </span>
        </button>
      </div>

      {(commentsExpanded || commentsMounted) && (
        <div className={commentsVisible ? "comment-pop" : "hidden"}>
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
