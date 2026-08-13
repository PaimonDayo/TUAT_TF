import { SubHeader } from "@/components/layout/SubHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { ItoEntryList } from "@/components/features/ItoEntryList";
import { ItoLiveRefresh } from "@/components/features/ItoLiveRefresh";
import { ItoPlayView } from "@/components/features/ItoPlayView";
import { ItoRanking } from "@/components/features/ItoRanking";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import {
  getItoPointEvents,
  getItoRoundState,
  getItoRounds,
  getMembersList,
  getMyItoOverview,
} from "@/lib/queries";

/** 部員向けの ito 画面。招待への回答と、進行中ラウンドのプレイ。 */
export default async function ItoPage() {
  const profile = await getCurrentProfile();
  // ito は公開準備中。いまはシステム管理者だけが使える。
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");

  const { invitations, participations, games } = await getMyItoOverview(profile.id);

  // 招待に「参加する」で答えた人と、進行役が直接追加した人（招待なし）の両方を参加者として扱う。
  const joinedGameIds = new Set([
    ...invitations
      .filter((invitation) => invitation.status === "joined")
      .map((invitation) => invitation.game_id),
    ...participations.map((participation) => participation.game_id),
  ]);
  const activeGame = games.find(
    (game) => joinedGameIds.has(game.id) && game.status === "active",
  );

  // 回答済みの招待カードは、ゲームが動き出したら邪魔なので出さない。
  // 未回答の招待だけは、進行中でも上に出す（回答してもらう必要があるため）。
  const pendingInvitations = invitations.filter(
    (invitation) => invitation.status === "pending",
  );
  const entryInvitations = activeGame ? pendingInvitations : invitations;

  const rounds = activeGame ? await getItoRounds(activeGame.id) : [];
  const currentRound = [...rounds].reverse()[0] ?? null;
  const [state, people, pointEvents] = await Promise.all([
    currentRound ? getItoRoundState(currentRound.id) : null,
    activeGame ? getMembersList() : [],
    activeGame ? getItoPointEvents(activeGame.id) : [],
  ]);

  return (
    <>
      <SubHeader title="itoゲーム" backHref="/mypage" />

      {/* 招待・ラウンド・共有状態の変化を拾って自動で最新にする（描画なし）。 */}
      <ItoLiveRefresh
        gameId={activeGame?.id}
        roundId={currentRound?.id}
        profileId={profile.id}
      />

      <div className="px-4 pt-2 space-y-4">
        {invitations.length === 0 && participations.length === 0 && (
          <EmptyState
            title="まだ招待はありません"
            description="ゲームに招待されると、ここで参加するかどうかを選べます。"
          />
        )}

        {entryInvitations.length > 0 && (
          <ItoEntryList invitations={entryInvitations} games={games} />
        )}

        {activeGame && currentRound && state && (
          <ItoPlayView
            data={{
              game: activeGame,
              round: currentRound,
              groups: state.groups,
              members: state.members,
              answers: state.answers,
              orders: state.orders,
              secrets: state.secrets,
              scores: state.scores,
              people,
              viewerId: profile.id,
            }}
          />
        )}

        {activeGame && !currentRound && (
          <Card className="p-4">
            <p className="text-[15px] font-semibold">まもなく始まります</p>
            <p className="text-caption mt-1">
              進行役がラウンドを開始すると、この画面に表示されます。
            </p>
          </Card>
        )}

        {activeGame && pointEvents.length > 0 && (
          <ItoRanking events={pointEvents} people={people} viewerId={profile.id} />
        )}
      </div>
    </>
  );
}
