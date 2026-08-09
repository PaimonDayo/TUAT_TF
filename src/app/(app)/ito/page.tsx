import { SubHeader } from "@/components/layout/SubHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { ItoEntryList } from "@/components/features/ItoEntryList";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getMyItoOverview } from "@/lib/queries";

/** 部員向けの ito 画面。いまはエントリー（参加確認）まで。 */
export default async function ItoPage() {
  const profile = await getCurrentProfile();
  const { invitations, games } = await getMyItoOverview(profile.id);

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
      </div>
    </>
  );
}
