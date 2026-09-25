import { SubHeader } from "@/components/layout/SubHeader";
import { PbManager } from "@/components/features/PbManager";
import { OfficialResultsList } from "@/components/features/OfficialResultsList";
import { getCurrentUserId } from "@/lib/supabase/auth";
import {
  getCompetitionEvents,
  getCompetitions,
  getPbRecords,
  getOfficialResults,
} from "@/lib/queries";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { PbRecord } from "@/types";

export default async function PbPage() {
  const userId = await getCurrentUserId();
  const [pbs, events, competitions, officialResults] = await Promise.all([
    getPbRecords(userId) as Promise<PbRecord[]>,
    getCompetitionEvents(),
    getCompetitions(),
    getOfficialResults(userId),
  ]);

  return (
    <>
      <SubHeader title="大会・記録会の結果" backHref="/mypage" />

      <div className="space-y-4 px-4 pt-2">
        {officialResults.length > 0 && (
          <section className="space-y-2">
            <p className="section-label">公式記録</p>
            <OfficialResultsList results={officialResults} />
          </section>
        )}
        {officialResults.length > 0 && <p className="section-label">自分で登録した結果</p>}
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
