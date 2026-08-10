"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * ito の画面を自動で最新に保つ。描画は何もしない。
 *
 * - Realtime（postgres_changes）で変更を検知して取り直す
 * - あわせて一定間隔でも取り直す。合宿先のように回線が不安定で
 *   WebSocket が切れたままでも、画面が止まらないようにするための保険
 * - タブに戻ったとき・オンラインに復帰したときも取り直す
 *
 * 通知の中身は信用せず、必ずサーバーから取り直す（サーバーが正）。
 */
export function ItoLiveRefresh({
  gameId,
  roundId,
  profileId,
  intervalMs = 5000,
}: {
  gameId?: string | null;
  roundId?: string | null;
  profileId?: string | null;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => router.refresh();

    const channel = supabase.channel(`ito-live-${roundId ?? gameId ?? profileId ?? "none"}`);
    if (gameId) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ito_games", filter: `id=eq.${gameId}` },
        refresh,
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ito_rounds", filter: `game_id=eq.${gameId}` },
        refresh,
      );
    }
    if (roundId) {
      for (const table of [
        "ito_groups",
        "ito_group_members",
        "ito_group_orders",
        "ito_leader_answers",
        "ito_round_scores",
      ]) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `round_id=eq.${roundId}` },
          refresh,
        );
      }
    }
    if (profileId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ito_invitations",
          filter: `profile_id=eq.${profileId}`,
        },
        refresh,
      );
    }
    channel.subscribe();

    // Realtime が届かない環境でも止まらないように、見えている間だけ定期的に取り直す。
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);

    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      void supabase.removeChannel(channel);
    };
  }, [gameId, intervalMs, profileId, roundId, router]);

  return null;
}
