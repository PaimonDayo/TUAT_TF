import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionManager } from "@/components/features/CompetitionManager";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitions } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

export default async function CompetitionsPage() {
  const profile = await getCurrentProfile();
  const competitions = await getCompetitions();
  // Server Component: リクエスト時刻を初期HTMLとクライアントで共有する。
  // eslint-disable-next-line react-hooks/purity
  const initialNow = Date.now();

  return (
    <>
      <SubHeader title="大会" backHref="/mypage" />
      <div className="space-y-3 px-4 pt-2">
        <CompetitionManager
          initial={competitions}
          initialNow={initialNow}
          canManage={permissionsOf(profile.roles).manageSystem}
        />
      </div>
    </>
  );
}
