import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatRecordedOn } from "@/lib/competition-record";
import type { OfficialResult } from "@/lib/queries";

/**
 * 大会の公式速報から、本名一致が確認できた本人の結果。読み取り専用。
 * 部員が自分で登録する「大会・記録会の結果」とは別に、大会ごとにまとめて並べる。
 */
export function OfficialResultsList({ results }: { results: OfficialResult[] }) {
  const groups = new Map<string, { competition: NonNullable<OfficialResult["competition"]>; rows: OfficialResult[] }>();
  for (const row of results) {
    if (!row.competition) continue;
    const group = groups.get(row.competition.id) ?? { competition: row.competition, rows: [] };
    group.rows.push(row);
    groups.set(row.competition.id, group);
  }
  if (groups.size === 0) return null;

  return (
    <div className="space-y-3">
      {[...groups.values()].map(({ competition, rows }) => (
        <section key={competition.id} className="space-y-1.5">
          <Link href={`/competitions/${competition.id}/program`} className="flex items-baseline justify-between gap-2 pressable">
            <span className="text-caption font-semibold text-muted2">{competition.name}</span>
            <span className="text-micro text-muted">{formatRecordedOn(competition.starts_on, "day")}</span>
          </Link>
          <Card className="divide-y divide-separator">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-3 p-3.5">
                <p className="min-w-0 flex-1 text-headline break-words">{row.event_label}</p>
                <span className="text-right text-title tabular-nums">
                  {row.record ?? "-"}
                  {row.place ? <span className="block text-caption text-muted">{row.place}位</span> : null}
                </span>
              </div>
            ))}
          </Card>
        </section>
      ))}
      <p className="text-micro text-muted2">大会の公式速報から自動で反映しています（本名が確認できた分のみ）。</p>
    </div>
  );
}
