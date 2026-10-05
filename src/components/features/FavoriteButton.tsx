"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserCheck } from "lucide-react";
import { getCurrentUserId } from "@/lib/supabase/client-auth";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export const FAVORITE_CHANGE_EVENT = "favorite-change";

type FavoritePending = { userId: string; next: boolean };
type FavoriteState = { favorited: boolean; busy: boolean; pending: FavoritePending | null };

export function FavoriteButton({ targetId, initial }: { targetId: string; initial: boolean }) {
  const queryClient = useQueryClient();
  const stateKey = ["social-favorite", targetId] as const;
  const { data: state } = useQuery({
    queryKey: stateKey,
    queryFn: async (): Promise<FavoriteState> => ({ favorited: initial, busy: false, pending: null }),
    initialData: { favorited: initial, busy: false, pending: null } as FavoriteState,
    staleTime: Infinity,
    enabled: false,
  });
  const fav = state.favorited;
  const busy = state.busy;
  const { showToast } = useToast();

  function finish(next: boolean) {
    queryClient.setQueryData(stateKey, { favorited: next, busy: false, pending: null });
    window.dispatchEvent(new CustomEvent(FAVORITE_CHANGE_EVENT, {
      detail: { targetId, favorited: next },
    }));
  }

  async function confirmResult(pending: FavoritePending) {
    queryClient.setQueryData(stateKey, { favorited: pending.next, busy: true, pending });
    try {
      const { data, error } = await createClient().from("favorites")
        .select("favorite_user_id").eq("user_id", pending.userId).eq("favorite_user_id", targetId).maybeSingle();
      if (error || (data && data.favorite_user_id !== targetId)) throw new Error("Favorite state was not confirmed");
      const confirmed = Boolean(data);
      if (confirmed === pending.next) finish(confirmed);
      else {
        // Keep checking the original intent: the response was lost, and a
        // mismatched read alone does not establish that the write was rejected.
        queryClient.setQueryData(stateKey, { favorited: confirmed, busy: false, pending });
        showToast("フォローの保存結果を確認できませんでした");
      }
    } catch {
      queryClient.setQueryData(stateKey, { favorited: pending.next, busy: false, pending });
      showToast("フォローの保存結果を確認できませんでした");
    }
  }

  async function toggle() {
    const current = queryClient.getQueryData<FavoriteState>(stateKey) ?? state;
    if (current.busy) return;
    if (current.pending) {
      await confirmResult(current.pending);
      return;
    }
    const previous: FavoriteState = { favorited: current.favorited, busy: false, pending: null };
    const next = !current.favorited;
    queryClient.setQueryData(stateKey, { favorited: next, busy: true, pending: null });

    let pending: FavoritePending | null = null;
    try {
      const supabase = createClient();
      const userId = await getCurrentUserId(supabase);
      if (!userId) {
        queryClient.setQueryData(stateKey, previous);
        showToast("ログイン状態を確認できませんでした");
        return;
      }
      pending = { userId, next };
      const result = next
        ? await supabase.from("favorites")
            .upsert({ user_id: userId, favorite_user_id: targetId }, { onConflict: "user_id,favorite_user_id" })
            .select("favorite_user_id").single()
        : await supabase.from("favorites").delete()
            .eq("user_id", userId).eq("favorite_user_id", targetId).select("favorite_user_id");
      if (result.error && !result.error.code) {
        await confirmResult(pending);
        return;
      }
      const confirmedTarget = next
        ? result.data && !Array.isArray(result.data) && result.data.favorite_user_id === targetId
        : Array.isArray(result.data) && result.data.length === 1 && result.data[0].favorite_user_id === targetId;
      if (result.error || !confirmedTarget) {
        queryClient.setQueryData(stateKey, previous);
        showToast(next ? "フォローできませんでした" : "フォローを解除できませんでした");
        return;
      }
      finish(next);
    } catch {
      if (pending) await confirmResult(pending);
      else {
        queryClient.setQueryData(stateKey, previous);
        showToast("ログイン状態を確認できませんでした");
      }
    } finally {
      queryClient.setQueryData(stateKey, (current: FavoriteState | undefined) =>
        current ? { ...current, busy: false } : current,
      );
    }
  }
  return (
    <button
      data-ui-action
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={fav}
      aria-label={state.pending ? "フォローの保存結果を確認" : undefined}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold pressable disabled:opacity-50",
        fav ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card text-muted2",
      )}
    >
      {fav ? <UserCheck size={16} className="shrink-0" /> : <UserPlus size={16} className="shrink-0" />}
      {state.pending ? "確認する" : fav ? "フォロー中" : "フォロー"}
    </button>
  );
}
