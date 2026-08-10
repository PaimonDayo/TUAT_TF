import { SubHeader } from "@/components/layout/SubHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { ItoEntryList } from "@/components/features/ItoEntryList";
import { ItoPlayView } from "@/components/features/ItoPlayView";
import { ItoRanking } from "@/components/features/ItoRanking";
import { getCurrentProfile } from "@/lib/supabase/auth";
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
  const { invitations, games } = await getMyItoOverview(profile.id);

  // 参加中のゲーム（新しい順）のうち、いま動いているものを1つ表示する。
  const joinedGameIds = invitations
    .filter((invitation) => invitation.status === "joined")
    .map((invitation) => invitation.game_id);
  const activeGame = games.find(
    (game) => joinedGameIds.includes(game.id) && game.status === "active",
  );

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

      <div className="px-4 pt-2 space-y-4">
        {invitations.length === 0 ? (
          <EmptyState
            title="まだ招待はありません"
            description="ゲームに招待されると、ここで参加するかどうかを選べます。"
          />
        ) : (
          <ItoEntryList invitations={invitations} games={games} />
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
