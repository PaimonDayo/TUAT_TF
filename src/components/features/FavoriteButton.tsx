"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** 部員をフォロー/解除するボタン（内部的にはお気に入りテーブル） */
export function FavoriteButton({ targetId, initial }: { targetId: string; initial: boolean }) {
  const router = useRouter();
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !fav;
    setFav(next);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    if (next) {
      await supabase.from("favorites").insert({ user_id: user.id, favorite_user_id: targetId });
    } else {
      await supabase
        .from("favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("favorite_user_id", targetId);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      className={cn(
        "h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold active:opacity-60 border",
        fav ? "text-accent border-accent bg-accent/10" : "text-muted2 border-separator bg-card",
      )}
    >
      {fav ? <UserCheck size={16} /> : <UserPlus size={16} />}
      {fav ? "フォロー中" : "フォロー"}
    </button>
  );
}
