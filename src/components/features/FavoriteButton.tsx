"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** 部員をお気に入り登録/解除するボタン */
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
        "h-9 px-2.5 inline-flex items-center gap-1 rounded-full text-[13px] font-semibold active:opacity-60",
        fav ? "text-warning" : "text-muted2",
      )}
    >
      <Star size={18} fill={fav ? "#ff9500" : "none"} strokeWidth={2} />
      {fav ? "お気に入り" : "登録"}
    </button>
  );
}
