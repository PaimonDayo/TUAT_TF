import { SubHeader } from "@/components/layout/SubHeader";
import { PbManager } from "@/components/features/PbManager";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getPbRecords } from "@/lib/queries";
import type { PbRecord } from "@/types";

export default async function PbPage() {
  const profile = await getCurrentProfile();
  const pbs = (await getPbRecords(profile.id)) as PbRecord[];

  return (
    <>
      <SubHeader title="大会・記録会の結果" backHref="/mypage" />

      <div className="px-4 pt-2">
        <PbManager userId={profile.id} initial={pbs} />
      </div>
    </>
  );
}
