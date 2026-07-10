"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "@/components/common/Avatar";
import { gradeShort } from "@/lib/constants";
import type { Block, TargetType } from "@/types";

type Liker = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  blocks: Block[];
  grade: string | null;
};

/** いいねした人の一覧をボトムシートで表示（いいねボタンの長押しで開く） */
export function LikersSheet({
  targetType,
  targetId,
  open,
  onOpenChange,
}: {
  targetType: TargetType;
  targetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [likers, setLikers] = useState<Liker[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // 新しい対象を開いた直後は読み込み表示へ戻す。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLikers(null);
    const supabase = createClient();
    void supabase
      .from("likes")
      .select("created_at, profiles(id, display_name, avatar_url, blocks, grade)")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        const list = ((data ?? []) as unknown as { profiles: Liker | null }[])
          .map((row) => row.profiles)
          .filter((p): p is Liker => Boolean(p));
        setLikers(list);
      });
    return () => {
      active = false;
    };
  }, [open, targetType, targetId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="いいねした人" autoFocus={false}>
        {likers === null ? (
          <p className="py-8 text-center text-caption">読み込み中…</p>
        ) : likers.length === 0 ? (
          <p className="py-8 text-center text-caption">まだいいねがありません</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto pb-2">
            {likers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <Avatar
                  name={p.display_name}
                  avatarUrl={p.avatar_url}
                  blocks={p.blocks}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                  {p.display_name}
                </span>
                <span className="text-micro shrink-0">{gradeShort(p.grade) ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
