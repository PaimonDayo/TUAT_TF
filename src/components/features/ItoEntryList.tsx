"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { ITO_GAME_STATUS_LABELS } from "@/lib/ito-phase";
import { unwrapItoResult } from "@/lib/ito-result";
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
  // 新しい招待の検知と自動更新は、共通の ItoLiveRefresh がまとめて行う。

  async function respond(invitation: ItoInvitation, accept: boolean) {
    setBusyId(invitation.id);
    try {
      unwrapItoResult(await respondItoInvitation(invitation.id, accept));
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
