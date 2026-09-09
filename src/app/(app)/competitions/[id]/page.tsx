import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Target } from "lucide-react";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
} from "@/lib/competition-record";
import { sortCompetitionEvents } from "@/lib/competition-goals";

/** 大会のページ。その大会の目標への導線と、部員全員の結果を種目別に並べる */
export default async function CompetitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const competition = await getCompetitionById(id);
  if (!competition) notFound();

  const [results, events] = await Promise.all([
    getCompetitionResults(id),
    getCompetitionEvents(),
  ]);
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

        <Card>
          <Link
            href={`/competitions/${competition.id}/goals`}
            className="flex items-center gap-3 p-4 active:opacity-70"
          >
            <Target size={20} className="text-accent" />
            <span className="flex-1 text-headline">みんなの目標</span>
            <ChevronRight size={16} className="text-muted" />
          </Link>
        </Card>

        <p className="section-label">結果（{results.length}件）</p>
        {groups.length === 0 ? (
          <Card>
            <EmptyState title="まだこの大会の結果はありません" />
          </Card>
        ) : (
          groups.map((group) => (
            <section key={group.name} className="space-y-1.5">
              <p className="section-label">{group.name}</p>
              <Card className="divide-y divide-separator">
                {group.rows.map((row) => (
                  <div key={row.id} className="flex items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-headline break-words">
                        {row.author?.display_name ?? "部員"}
                      </p>
                      {row.wind !== null && (
                        <p className="text-caption">
                          風速 {formatWind(row.wind)}
                        </p>
                      )}
                    </div>
                    <span className="text-title tabular-nums">
                      {formatRecord(row, measureTypeOf(events, row.event_name))}
                    </span>
                  </div>
                ))}
              </Card>
            </section>
          ))
        )}
      </div>
    </>
  );
}
