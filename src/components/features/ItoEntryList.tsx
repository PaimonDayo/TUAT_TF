"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { ITO_GAME_STATUS_LABELS } from "@/lib/ito-phase";
import { respondItoInvitation } from "@/app/(app)/ito/actions";
import type { ItoGame, ItoInvitation } from "@/types";

/**
 * 自分あての招待一覧。回答はサーバー（RPC）で確定し、
 * 招待行の変更は Realtime で拾って最新状態に戻す。
 */
export function ItoEntryList({
  invitations,
  games,
}: {
  invitations: ItoInvitation[];
  games: ItoGame[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const profileId = invitations[0]?.profile_id;

  useEffect(() => {
    if (!profileId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`ito-invitations-${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ito_invitations",
          filter: `profile_id=eq.${profileId}`,
        },
        // 通知はきっかけとしてだけ使い、中身はサーバーから取り直す。
        () => router.refresh(),
      )
      .subscribe();

    function visible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(channel);
    };
  }, [profileId, router]);

  async function respond(invitation: ItoInvitation, accept: boolean) {
    setBusyId(invitation.id);
    try {
      await respondItoInvitation(invitation.id, accept);
      showToast(accept ? "参加で回答しました" : "不参加で回答しました");
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "回答を保存できませんでした");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {invitations.map((invitation) => {
        const game = games.find((item) => item.id === invitation.game_id);
        if (!game) return null;
        const answering = busyId === invitation.id;
        return (
          <Card key={invitation.id} className="space-y-3 p-3">
            <div>
              <p className="text-headline break-words">{game.name}</p>
              <p className="text-caption">
                {invitation.round_no > 1
                  ? `Round ${invitation.round_no} からの参加`
                  : ITO_GAME_STATUS_LABELS[game.status]}
              </p>
              {game.theme && <p className="text-caption mt-0.5">お題: {game.theme}</p>}
            </div>

            {invitation.status === "pending" ? (
              <>
                <p className="text-[15px] font-semibold">
                  {game.name} に参加しますか？
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="lg"
                    disabled={answering}
                    onClick={() => void respond(invitation, true)}
                    className="gap-1"
                  >
                    <Check size={16} /> 参加する
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    disabled={answering}
                    onClick={() => void respond(invitation, false)}
                    className="gap-1"
                  >
                    <X size={16} /> 参加しない
                  </Button>
                </div>
              </>
            ) : (
              <p
                className={`text-[15px] font-semibold ${
                  invitation.status === "joined" ? "text-success" : "text-muted2"
                }`}
              >
                {invitation.status === "joined"
                  ? "参加で回答しました（サーバーに保存済み）"
                  : "不参加で回答しました"}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
