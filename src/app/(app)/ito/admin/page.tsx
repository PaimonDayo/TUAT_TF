import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { ItoAdminConsole } from "@/components/features/ItoAdminConsole";
import { ItoRoundConsole } from "@/components/features/ItoRoundConsole";
import { ItoLiveRefresh } from "@/components/features/ItoLiveRefresh";
import { ItoRanking } from "@/components/features/ItoRanking";
import { getCurrentProfile } from "@/lib/supabase/auth";
import {
  getAllProfiles,
  getAllRoles,
  getItoGames,
  getItoInvitations,
  getItoParticipants,
  getItoPointEvents,
  getItoRoundState,
  getItoRounds,
  getItoSecretStatus,
  getMembersList,
} from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { itoInviteTargets } from "@/lib/ito-entry";
import type { ItoInvitation } from "@/types";

/** ito の進行画面。システム管理者だけが開ける。 */
export default async function ItoAdminPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");

  const [games, roles, members, people] = await Promise.all([
    getItoGames(),
    getAllRoles(),
    getAllProfiles(),
    getMembersList(),
  ]);

  const activeMembers = members.filter((member) => member.status === "active");
  const invitationsByGame = new Map<string, ItoInvitation[]>();
  for (const game of games) {
    invitationsByGame.set(game.id, await getItoInvitations(game.id));
  }

  // 進行中のゲームは1つだけ進行画面を出す（同時進行は想定しない）。
  const runningGame = games.find((game) => game.status === "active");
  const rounds = runningGame ? await getItoRounds(runningGame.id) : [];
  const currentRound = [...rounds].reverse()[0] ?? null;
  const [roundState, secretStatus, participants, pointEvents] = await Promise.all([
    currentRound ? getItoRoundState(currentRound.id) : null,
    currentRound ? getItoSecretStatus(currentRound.id) : [],
    runningGame ? getItoParticipants(runningGame.id) : [],
    runningGame ? getItoPointEvents(runningGame.id) : [],
  ]);

  return (
    <>
      <SubHeader title="itoゲーム" backHref="/mypage" />

      {/* 部員の操作（代表者選択・提出）を待たずに自動で最新にする（描画なし）。 */}
      <ItoLiveRefresh gameId={runningGame?.id} roundId={currentRound?.id} />

      <div className="px-4 pt-2 space-y-6">
        {runningGame && (
          <section className="space-y-2">
            <p className="section-label">進行中：{runningGame.name}</p>
            <ItoRoundConsole
              data={{
                game: runningGame,
                round: currentRound,
                groups: roundState?.groups ?? [],
                members: roundState?.members ?? [],
                answers: roundState?.answers ?? [],
                orders: roundState?.orders ?? [],
                scores: roundState?.scores ?? [],
                secretStatus,
                people,
                participantCount: participants.filter((row) => row.status === "active").length,
                viewerId: profile.id,
                viewerJoined: participants.some(
                  (row) => row.profile_id === profile.id && row.status === "active",
                ),
              }}
            />
            {pointEvents.length > 0 && <ItoRanking events={pointEvents} people={people} />}
          </section>
        )}

        <ItoAdminConsole
          games={games}
          roles={roles}
          invitations={Object.fromEntries(invitationsByGame)}
          memberNames={Object.fromEntries(
            activeMembers.map((member) => [member.id, member.display_name || "名無し"]),
          )}
          targetCounts={Object.fromEntries(
            roles.map((role) => [
              role.id,
              itoInviteTargets({ candidates: activeMembers, targetRoleId: role.id }).length,
            ]),
          )}
        />
      </div>
    </>
  );
}
