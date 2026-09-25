import { SubHeader } from "@/components/layout/SubHeader";
import { PbManager } from "@/components/features/PbManager";
import { getCurrentUserId } from "@/lib/supabase/auth";
import {
  getCompetitionEvents,
  getCompetitions,
  getPbRecords,
} from "@/lib/queries";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { PbRecord } from "@/types";

export default async function PbPage() {
  const userId = await getCurrentUserId();
  const [pbs, events, competitions] = await Promise.all([
    getPbRecords(userId) as Promise<PbRecord[]>,
    getCompetitionEvents(),
    getCompetitions(),
  ]);

  return (
    <>
      <SubHeader title="大会・記録会の結果" backHref="/mypage" />

      <div className="px-4 pt-2">
        <PbManager
          userId={userId}
          initial={pbs}
          events={events as CompetitionEvent[]}
          competitions={competitions}
        />
      </div>
    </>
  );
}
