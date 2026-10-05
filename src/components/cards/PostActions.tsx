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
  pending: { desiredLiked: boolean } | null;
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
    queryFn: async (): Promise<InteractionState> => ({ liked: initialLiked, likes: initialLikes, commentCount: initialComments, busy: false, pending: null }),
    initialData: { liked: initialLiked, likes: initialLikes, commentCount: initialComments, busy: false, pending: null } as InteractionState,
    staleTime: Infinity,
    enabled: false,
  });
  const { liked, likes, commentCount, pending } = interaction;
  const mutationBusy = useRef(false);

  useEffect(() => {
    if (mutationBusy.current || queryClient.getQueryData<InteractionState>(interactionKey)?.pending) return;
    queryClient.setQueryData(interactionKey, (previous: InteractionState | undefined) => ({ liked: initialLiked, likes: initialLikes, commentCount: previous?.commentCount ?? initialComments, busy: false, pending: null }));
  // interactionKey is fully represented by the primitive dependencies below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialComments, initialLiked, initialLikes, queryClient, targetId, targetType, currentUser.id]);


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
          pending: null,
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

  function finishLike(nextLiked: boolean, nextLikes: number) {
    queryClient.setQueryData(interactionKey, (current: InteractionState | undefined) => ({
      ...(current ?? interaction), liked: nextLiked, likes: nextLikes, busy: false, pending: null,
    }));
    updateTimelineLikeState(nextLiked, nextLikes);
  }

  async function confirmLikeResult(desiredLiked: boolean) {
    queryClient.setQueryData(interactionKey, (current: InteractionState | undefined) => ({
      ...(current ?? interaction), busy: true, pending: { desiredLiked },
    }));
    try {
      const supabase = createClient();
      const [total, own] = await Promise.all([
        supabase.from("likes").select("id", { count: "exact", head: true })
          .eq("target_type", targetType).eq("target_id", targetId),
        supabase.from("likes").select("id", { count: "exact", head: true })
          .eq("target_type", targetType).eq("target_id", targetId).eq("user_id", currentUser.id),
      ]);
      if (total.error || own.error || total.count === null || own.count === null ||
        !Number.isInteger(total.count) || total.count < 0 || (own.count !== 0 && own.count !== 1) || total.count < own.count) {
        throw new Error("Like state was not confirmed");
      }
      const confirmedLiked = own.count === 1;
      if (confirmedLiked === desiredLiked) finishLike(confirmedLiked, total.count);
      else {
        // A lost write response can still be in flight. A mismatched read does
        // not prove rejection, so retain the original intent without replaying it.
        queryClient.setQueryData(interactionKey, (current: InteractionState | undefined) => ({
          ...(current ?? interaction), liked: confirmedLiked, likes: total.count!, busy: false, pending: { desiredLiked },
        }));
        updateTimelineLikeState(confirmedLiked, total.count);
        showToast("いいねの保存結果を確認できませんでした");
      }
    } catch {
      queryClient.setQueryData(interactionKey, (current: InteractionState | undefined) => ({
        ...(current ?? interaction), busy: false, pending: { desiredLiked },
      }));
      showToast("いいねの保存結果を確認できませんでした");
    }
  }

  async function toggleLike() {
    const current = queryClient.getQueryData<InteractionState>(interactionKey) ?? interaction;
    if (current.busy || mutationBusy.current) return;
    mutationBusy.current = true;
    if (current.pending) {
      try { await confirmLikeResult(current.pending.desiredLiked); }
      finally { mutationBusy.current = false; }
      return;
    }
    const previous = { ...current, busy: false };
    const next = !current.liked;
    const optimistic = {
      ...current,
      liked: next,
      likes: Math.max(0, current.likes + (next ? 1 : -1)),
      busy: true,
    };
    queryClient.setQueryData(interactionKey, optimistic);

    updateTimelineLikeState(next, optimistic.likes);
    let writeStarted = false;
    try {
      const supabase = createClient();
      // 認証確認・insert/delete・件数再取得をDB内の1トランザクションへまとめる。
      // UIは先に楽観反映し、RPCが返した実件数だけで確定する。
      writeStarted = true;
      const { data, error } = await supabase.rpc("set_like_state", {
        target_type_in: targetType,
        target_id_in: targetId,
        desired_liked: next,
      });
      if (error && !error.code) {
        await confirmLikeResult(next);
        return;
      }
      const confirmedRow = data?.[0];
      const confirmedLikes = Number(confirmedRow?.likes_count);
      if (error || !confirmedRow || confirmedRow.liked !== next || !Number.isInteger(confirmedLikes) || confirmedLikes < 0) {
        finishLike(previous.liked, previous.likes);
        showToast(next ? "いいねできませんでした" : "いいねを解除できませんでした");
        return;
      }
      finishLike(next, confirmedLikes);
    } catch {
      if (writeStarted) await confirmLikeResult(next);
      else {
        finishLike(previous.liked, previous.likes);
        showToast(next ? "いいねできませんでした" : "いいねを解除できませんでした");
      }
    } finally {
      mutationBusy.current = false;
    }
  }
  useEffect(() => {
    toggleLikeRef.current = toggleLike;
  });

  return (
    <>
      <div
        data-ui-group
        ref={actionsRef}
        className="flex select-none items-center gap-5 pt-1 [-webkit-touch-callout:none] [-webkit-user-select:none]"
      >
        <button
          data-ui-reaction
          ref={likeButtonRef}
          type="button"
          aria-pressed={liked}
          aria-label={
            pending ? "いいねの保存結果を確認" : liked
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
            "no-native-callout flex touch-none select-none items-center gap-1.5 text-[13px] pressable",
            liked ? "text-danger" : "text-muted",
          )}
        >
          <Heart size={18} fill={liked ? "#ff3b30" : "none"} strokeWidth={2} />
          {/* 常に数字を描画し0は透明にする＝箱が一定でガクつかない */}
          <span className={cn("inline-block text-left tabular-nums", pending ? "text-[11px]" : "w-5", !pending && likes === 0 && "opacity-0")}>
            {pending ? "確認する" : likes}
          </span>
        </button>
        <button
          data-ui-reaction
          type="button"
          onClick={toggleComments}
          aria-label={`コメント${commentsVisible ? "を閉じる" : "を表示"}、${commentCount}件`}
          aria-expanded={commentsVisible}
          className={cn(
            "flex items-center gap-1.5 text-[13px] pressable",
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
