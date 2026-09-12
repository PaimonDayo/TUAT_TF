"use client";

import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LikersSheet } from "@/components/cards/LikersSheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * コメント1件へのいいね。タップで付け外し、長押しでいいねした人の一覧。
 * 投稿のいいねと同じ likes テーブル（target_type='comment'）を使う。
 */
export function CommentLikeButton({
  commentId,
  liked,
  count,
  onChange,
}: {
  commentId: string;
  liked: boolean;
  count: number;
  /** 送信結果で確定した状態。失敗時は元の値で呼び直す */
  onChange: (next: { liked: boolean; count: number }) => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // iOSは長押しで文字選択・コールアウトを出すので、この操作の間だけ抑止する。
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const suppress = (event: Event) => {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    };
    button.addEventListener("selectstart", suppress);
    button.addEventListener("contextmenu", suppress);
    return () => {
      button.removeEventListener("selectstart", suppress);
      button.removeEventListener("contextmenu", suppress);
    };
  }, []);

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    [],
  );

  function startPress() {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setLikersOpen(true);
    }, 450);
  }

  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  async function toggle() {
    if (busy) return;
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    const next = !liked;
    const previous = { liked, count };
    setBusy(true);
    onChange({ liked: next, count: Math.max(0, count + (next ? 1 : -1)) });

    const { data, error } = await createClient().rpc("set_like_state", {
      target_type_in: "comment",
      target_id_in: commentId,
      desired_liked: next,
    });
    const confirmed = data?.[0];
    setBusy(false);
    if (error || !confirmed || confirmed.liked !== next) {
      onChange(previous);
      showToast(next ? "いいねできませんでした" : "いいねを解除できませんでした", "error");
      return;
    }
    onChange({ liked: next, count: Number(confirmed.likes_count) });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={busy}
        aria-label={liked ? "いいねを解除" : "いいね"}
        aria-pressed={liked}
        onClick={() => void toggle()}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        className={cn(
          "mt-1 inline-flex h-7 select-none touch-manipulation items-center gap-1 rounded-full px-2 text-[12px] pressable disabled:opacity-60 [-webkit-touch-callout:none]",
          liked ? "text-danger" : "text-muted2",
        )}
      >
        <Heart size={14} className={liked ? "fill-danger" : undefined} />
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </button>

      <LikersSheet
        targetType="comment"
        targetId={commentId}
        open={likersOpen}
        onOpenChange={setLikersOpen}
      />
    </>
  );
}
