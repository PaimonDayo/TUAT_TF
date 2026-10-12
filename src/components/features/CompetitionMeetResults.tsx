import Link from "next/link";
import { CompetitionResults } from "./CompetitionResults";
import { ObLiveRefresh } from "./ObLiveRefresh";
import { meetResultRows } from "@/lib/competition-meet-results";
import type { CompetitionMeet } from "@/lib/competition-meet";

export function CompetitionMeetResults({ meet, date, canOperate = false }: { meet: CompetitionMeet; date: string; canOperate?: boolean }) {
  return <div className="space-y-4 px-4 pb-8 pt-2">
    <div className="flex items-center justify-between gap-3"><h2 className="text-headline">結果</h2>
      {canOperate && <Link data-ui-action="text" className="flex min-h-11 items-center text-body text-accent" href={`/competitions/${meet.competitionId}/manage`}>大会の運営 →</Link>}
    </div>
    <ObLiveRefresh readOnly />
    <CompetitionResults rows={meetResultRows(meet, date)} />
  </div>;
}
