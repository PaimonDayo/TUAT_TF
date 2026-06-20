"use client";

import { useState } from "react";
import { Check, CircleHelp, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { NoticeReaction } from "@/types";

const REACTIONS: {
  key: NoticeReaction;
  label: string;
  icon: typeof Check;
}[] = [
  { key: "ack", label: "確認", icon: Check },
  { key: "thanks", label: "ありがとう", icon: Heart },
  { key: "question", label: "質問あり", icon: CircleHelp },
];

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
  const [counts, setCounts] = useState(initialCounts);
  const [mine, setMine] = useState(() => new Set(initialMine));
  const [busy, setBusy] = useState<NoticeReaction | null>(null);

  async function toggle(reaction: NoticeReaction) {
    if (busy) return;
    const active = mine.has(reaction);
    setBusy(reaction);
    setMine((current) => {
      const next = new Set(current);
      if (active) next.delete(reaction);
      else next.add(reaction);
      return next;
    });
    setCounts((current) => ({
      ...current,
      [reaction]: Math.max(0, current[reaction] + (active ? -1 : 1)),
    }));

    const supabase = createClient();
    const result = active
      ? await supabase
          .from("notice_reactions")
          .delete()
          .eq("notice_id", noticeId)
          .eq("user_id", userId)
          .eq("reaction", reaction)
      : await supabase
          .from("notice_reactions")
          .insert({ notice_id: noticeId, user_id: userId, reaction });

    if (result.error) {
      setMine((current) => {
        const next = new Set(current);
        if (active) next.add(reaction);
        else next.delete(reaction);
        return next;
      });
      setCounts((current) => ({
        ...current,
        [reaction]: Math.max(0, current[reaction] + (active ? 1 : -1)),
      }));
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="お知らせへのリアクション">
      {REACTIONS.map(({ key, label, icon: Icon }) => {
        const active = mine.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            disabled={busy !== null}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 min-w-[76px] items-center justify-center gap-1 rounded-full border px-2 text-[11px] font-semibold transition-colors disabled:opacity-60",
              active
                ? "border-accent bg-accent/10 text-accent"
                : "border-separator bg-card text-muted2",
            )}
          >
            <Icon size={14} fill={key === "thanks" && active ? "currentColor" : "none"} />
            <span>{label}</span>
            <span className="min-w-3 text-center tabular-nums">{counts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}
