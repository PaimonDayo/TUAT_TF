import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { ItoAdminConsole } from "@/components/features/ItoAdminConsole";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getAllProfiles, getAllRoles, getItoGames, getItoInvitations } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { itoInviteTargets } from "@/lib/ito-entry";
import type { ItoInvitation } from "@/types";

/** ito の進行画面。システム管理者だけが開ける。 */
export default async function ItoAdminPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");

  const [games, roles, members] = await Promise.all([
    getItoGames(),
    getAllRoles(),
    getAllProfiles(),
  ]);

  const activeMembers = members.filter((member) => member.status === "active");
  const invitationsByGame = new Map<string, ItoInvitation[]>();
  for (const game of games) {
    invitationsByGame.set(game.id, await getItoInvitations(game.id));
  }

  const namesById = new Map(
    activeMembers.map((member) => [member.id, member.display_name || "名無し"]),
  );

  return (
    <>
      <SubHeader title="itoゲーム" backHref="/mypage" />

      <div className="px-4 pt-2 space-y-6">
        <ItoAdminConsole
          games={games}
          roles={roles}
          invitations={Object.fromEntries(invitationsByGame)}
          memberNames={Object.fromEntries(namesById)}
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
