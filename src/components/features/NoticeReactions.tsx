"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { NoticeReaction } from "@/types";

export function NoticeReactions({
  noticeId,
  userId,
  initialCounts,
  initialMine,
}: {
  noticeId: string;
  userId: string;
  initialCounts: Record<NoticeReaction, number>;
  initialMine: NoticeReaction[];
}) {
  const [count, setCount] = useState(initialCounts.ack);
  const [checked, setChecked] = useState(initialMine.includes("ack"));
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;

    const wasChecked = checked;
    setBusy(true);
    setChecked(!wasChecked);
    setCount((current) => Math.max(0, current + (wasChecked ? -1 : 1)));

    const supabase = createClient();
    const result = wasChecked
      ? await supabase
          .from("notice_reactions")
          .delete()
          .eq("notice_id", noticeId)
          .eq("user_id", userId)
          .eq("reaction", "ack")
      : await supabase
          .from("notice_reactions")
          .insert({ notice_id: noticeId, user_id: userId, reaction: "ack" });

    if (result.error) {
      setChecked(wasChecked);
      setCount((current) => Math.max(0, current + (wasChecked ? 1 : -1)));
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={checked}
      aria-label={checked ? "確認済みを取り消す" : "お知らせを確認済みにする"}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors disabled:opacity-50",
        checked ? "bg-accent/10 text-accent" : "bg-fill text-muted2 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "grid size-[18px] place-items-center rounded-full border transition-colors",
          checked ? "border-accent bg-accent text-white" : "border-muted2/60",
        )}
      >
        <Check size={12} strokeWidth={3} className={cn(!checked && "opacity-0")} />
      </span>
      <span>{checked ? "確認済み" : "確認"}</span>
      {count > 0 && <span className="font-medium tabular-nums opacity-65">{count}</span>}
    </button>
  );
}
