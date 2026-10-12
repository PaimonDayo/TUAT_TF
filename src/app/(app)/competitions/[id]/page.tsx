import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ListOrdered, Target } from "lucide-react";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { CompetitionResults } from "@/components/features/CompetitionResults";
import { getCompetitionMeet } from "@/lib/queries/competition-meet";
import { getCurrentProfile, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import type { ParsedProgramRow } from "@/lib/competition-program";
import {
  getCompetitionById,
  getCompetitionEvents,
  getCompetitionResults,
} from "@/lib/queries";
import {
  formatRecord,
  formatRecordedOn,
  formatWind,
  measureTypeOf,
  timeFormatOf,
} from "@/lib/competition-record";
import { sortCompetitionEvents } from "@/lib/competition-goals";
import { isObCompetition } from "@/lib/ob-meet";

/**
 * 大会のページ。結果の見せ場所は1つにする（2026-09-25 オーナー確定）。
 * プログラムがある大会は公式の結果がプログラムに載るので、ここでは一覧を出さない。
 * プログラムが無い大会だけ、部員が登録した記録を結果一覧として並べる。
 */
export default async function CompetitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const competition = await getCompetitionById(id);
  if (!competition) notFound();

  const [meet, profile, preview] = await Promise.all([getCompetitionMeet(id), getCurrentProfile(), isMemberPreviewActive()]);
  const canOperate = !preview && (meet ? meet.permissions.manage : !isObCompetition(id) && permissionsOf(profile.roles).manageSystem);
  const hasProgram = Boolean(competition.program_source_url) || !!meet || isObCompetition(id);
  const [results, events] = hasProgram
    ? [[], []]
    : await Promise.all([getCompetitionResults(competition), getCompetitionEvents()]);
  const ordered = sortCompetitionEvents(events);
  const groups = ordered
    .map((event) => ({
      name: event.name,
      rows: results.filter((r) => r.event_name === event.name),
    }))
    .concat(
      [
        ...new Set(
          results
            .filter((r) => !ordered.some((e) => e.name === r.event_name))
            .map((r) => r.event_name),
        ),
      ].map((name) => ({
        name,
        rows: results.filter((r) => r.event_name === name),
      })),
    )
    .filter((group) => group.rows.length > 0);

  return (
    <>
      <SubHeader title={competition.name} backHref="/competitions" />
      <div className="space-y-3 px-4 pt-2">
        <p className="text-caption">
          {formatRecordedOn(competition.starts_on, "day")}
          {competition.ends_on && competition.ends_on !== competition.starts_on
            ? ` 〜 ${formatRecordedOn(competition.ends_on, "day")}`
            : ""}
        </p>

        <Card className="divide-y divide-separator">
          {canOperate && <Link data-ui-row href={`/competitions/${competition.id}/manage`} className="flex items-center gap-3 p-4 pressable"><ListOrdered size={20} className="text-accent"/><span className="flex-1 text-headline">参加者・大会の運営</span><ChevronRight size={16} className="text-muted"/></Link>}
          {hasProgram && (
            <Link
              data-ui-row
              href={`/competitions/${competition.id}/program`}
              className="flex items-center gap-3 p-4 pressable"
            >
              <ListOrdered size={20} className="text-accent" />
              <span className="flex-1 text-headline">結果</span>
              <ChevronRight size={16} className="text-muted" />
            </Link>
          )}
          <Link
            data-ui-row
            href={`/competitions/${competition.id}/goals`}
            className="flex items-center gap-3 p-4 pressable"
          >
            <Target size={20} className="text-accent" />
            <span className="flex-1 text-headline">みんなの目標</span>
            <ChevronRight size={16} className="text-muted" />
          </Link>
        </Card>

        {hasProgram ? (
          <p className="text-caption">
            {competition.program_source_url ? "結果は公式の速報から取得しています。" : "結果は大会の記録から表示しています。"}
          </p>
        ) : (
          <>
          <p className="section-label">結果（{results.length}件）</p>
          <CompetitionResults rows={groups.flatMap((group, index) => [...new Set(group.rows.map(r => r.recorded_on ?? competition.starts_on))].map(date => ({
            eventDate: date, eventLabel: group.name, block: measureTypeOf(events, group.name) === "time" ? "track" : "field", sortOrder: index, timeLabel: null, roundKey: group.name + "/" + date, status: null,
            tuatEntries: group.rows.filter(r => (r.recorded_on ?? competition.starts_on) === date).map(r => ({ id: r.id, name: r.author?.display_name ?? "部員", grade: "", heat: null, lane: null, bib: null, separateResult: true, result: { place: null, record: formatRecord(r, measureTypeOf(events, r.event_name), timeFormatOf(events, r.event_name)), ...(r.wind !== null ? { wind: formatWind(r.wind) } : {}) } })),
          } satisfies ParsedProgramRow)))} />
          </>
        )}
      </div>
    </>
  );
}
