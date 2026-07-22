"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export const FAVORITE_CHANGE_EVENT = "favorite-change";

export function FavoriteButton({ targetId, initial }: { targetId: string; initial: boolean }) {
  const queryClient = useQueryClient();
  const stateKey = ["social-favorite", targetId] as const;
  const { data: state } = useQuery({
    queryKey: stateKey,
    queryFn: async () => ({ favorited: initial, busy: false }),
    initialData: { favorited: initial, busy: false },
    staleTime: Infinity,
    enabled: false,
  });
  const fav = state.favorited;
  const busy = state.busy;
  const { showToast } = useToast();

  async function toggle() {
    if (busy) return;
    const previous = { favorited: fav, busy: false };
    const next = !fav;
    queryClient.setQueryData(stateKey, { favorited: next, busy: true });

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      queryClient.setQueryData(stateKey, previous);
      showToast("ログイン状態を確認できませんでした");
      return;
    }

    const result = next
      ? await supabase
          .from("favorites")
          .upsert(
            { user_id: user.id, favorite_user_id: targetId },
            { onConflict: "user_id,favorite_user_id" },
          )
          .select("favorite_user_id")
          .single()
      : await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("favorite_user_id", targetId)
          .select("favorite_user_id");

    if (result.error || (!next && (!Array.isArray(result.data) || result.data.length !== 1))) {
      queryClient.setQueryData(stateKey, previous);
      showToast(next ? "フォローできませんでした" : "フォローを解除できませんでした");
      return;
    }

    queryClient.setQueryData(stateKey, { favorited: next, busy: false });
    window.dispatchEvent(new CustomEvent(FAVORITE_CHANGE_EVENT, {
      detail: { targetId, favorited: next },
    }));
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={fav}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold active:opacity-60 disabled:opacity-50",
        fav ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card text-muted2",
      )}
    >
      {fav ? <UserCheck size={16} /> : <UserPlus size={16} />}
      {fav ? "フォロー中" : "フォロー"}
    </button>
  );
}