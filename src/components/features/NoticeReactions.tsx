"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { NoticeAcknowledgersSheet } from "@/components/features/NoticeAcknowledgersSheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { NoticeReaction } from "@/types";

export function NoticeReactions({ noticeId, userId, initialCounts, initialMine }: {
  noticeId: string;
  userId: string;
  initialCounts: Record<NoticeReaction, number>;
  initialMine: NoticeReaction[];
}) {
  const [count, setCount] = useState(initialCounts.ack);
  const [checked, setChecked] = useState(initialMine.includes("ack"));
  const [busy, setBusy] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const { showToast } = useToast();
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function startPress() {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setPeopleOpen(true);
    }, 450);
  }

  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function handleClick() {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    void toggle();
  }

  async function toggle() {
    if (busy) return;
    const wasChecked = checked;
    setBusy(true);
    setChecked(!wasChecked);
    setCount((current) => Math.max(0, current + (wasChecked ? -1 : 1)));

    const supabase = createClient();
    const result = wasChecked
      ? await supabase.from("notice_reactions").delete().eq("notice_id", noticeId).eq("user_id", userId).eq("reaction", "ack").select("notice_id")
      : await supabase.from("notice_reactions").upsert({ notice_id: noticeId, user_id: userId, reaction: "ack" }, { onConflict: "notice_id,user_id,reaction" })
          .select("notice_id")
          .single();

    const deleteFailed = wasChecked && (!Array.isArray(result.data) || result.data.length !== 1);
    if (result.error || deleteFailed) {
      setChecked(wasChecked);
      setCount((current) => Math.max(0, current + (wasChecked ? 1 : -1)));
      showToast(wasChecked ? "確認を取り消せませんでした" : "確認を保存できませんでした");
    }
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={(event) => { event.preventDefault(); startPress(); }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => event.preventDefault()}
        disabled={busy}
        aria-pressed={checked}
        aria-label={checked ? "確認済みを取り消す。長押しで確認した人を表示" : "確認済みにする。長押しで確認した人を表示"}
        className={cn(
          "flex select-none touch-manipulation items-center gap-1.5 text-[13px] transition-active active:opacity-50 disabled:opacity-50 [-webkit-touch-callout:none]",
          checked ? "text-accent" : "text-muted",
        )}
      >
        <Check size={18} strokeWidth={checked ? 3 : 2} />
        <span className={cn("inline-block w-5 text-left tabular-nums", count === 0 && "opacity-0")}>{count}</span>
      </button>
      <NoticeAcknowledgersSheet noticeId={noticeId} open={peopleOpen} onOpenChange={setPeopleOpen} />
    </>
  );
}