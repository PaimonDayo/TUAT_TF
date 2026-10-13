"use client";
import { useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { normalizeEntryName } from "@/lib/entry-identity";
import { describeResult, formatAthleteLabel, groupEntriesByPosition, groupProgramByDate, type ParsedProgramRow, type ProgramAthlete } from "@/lib/competition-program";
import { ProgramEventSummary } from "./ProgramEventSummary";

/** 同じ組・レーンの全員が同一の結果（＝リレーのチーム記録）かどうか。 */
function sharedResult(entries: ProgramAthlete[]): boolean {
  if (entries.some(entry => entry.separateResult) || entries.length < 2 || !entries[0].result) return false;
  const first = JSON.stringify(entries[0].result);
  return entries.every((entry) => JSON.stringify(entry.result) === first);
}

/** 結果が出ている人を、同じ結果（リレーのチーム記録）ごとにまとめた一覧行にする。 */
function summarizeFinished(row: ParsedProgramRow): { names: string; text: string }[] {
  const out: { names: string; text: string }[] = [];
  for (const entry of row.tuatEntries) {
    if (!entry.result) continue;
    const text = describeResult(entry, row.eventLabel);
    const last = out.at(-1);
    if (last && !entry.separateResult && last.text === text) last.names += `・${formatAthleteLabel(entry)}`;
    else out.push({ names: formatAthleteLabel(entry), text });
  }
  return out;
}

/** 1種目ぶんの行。タップで出場者ごとの組・レーン・結果を開く。 */
export function CompetitionResultRow({ row }: { row: ParsedProgramRow }) {
  const [open, setOpen] = useState(false);
  const finished = row.tuatEntries.filter((entry) => entry.result);

  return (
    <div className="p-3.5">
      <button data-ui-row type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-2 text-left pressable">
        <span className="min-w-0 flex-1">
          <ProgramEventSummary row={{...row,tuatEntries:row.tuatEntries.slice(0,3)}} />
          <span className="ml-15 mt-1 block text-micro text-muted2">出場 {row.tuatEntries.length}件{row.status ? `・${row.status}` : ""}</span>
          {finished.length > 0 && !open && (
            // 順位・記録は開かなくても読めるようにする（開くと組・レーン・風も出る）。
            <span className="ml-15 mt-1 block space-y-0.5">
              {summarizeFinished(row).slice(0,5).map(({ names, text }, index) => (
                <span key={index} className="block text-caption text-accent">
                  {names}{" "}
                  <span className="font-semibold tabular-nums">{text}</span>
                </span>
              ))}
              {finished.length > 5 && <span className="block text-micro text-muted2">全員の結果を開く →</span>}
            </span>
          )}
        </span>
        <ChevronDown size={16} className={"mt-1 shrink-0 text-muted transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 sm:ml-[52px]">
          {groupEntriesByPosition(row.tuatEntries).map(({ position, entries }, index) => (
            <li key={index} className="rounded-lg bg-bg px-2.5 py-2 text-[13px]">
              {position && <p className="text-micro text-muted2">{position}</p>}
              {sharedResult(entries) ? (
                // リレーはチーム1つの記録なので、4人ぶん同じ行を繰り返さない。
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">{entries.map(formatAthleteLabel).join("・")}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{describeResult(entries[0], row.eventLabel)}</span>
                </p>
              ) : (
                entries.map((entry, i) => (
                  <p key={entry.id ?? i} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{formatAthleteLabel(entry)}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {entry.result ? describeResult(entry, row.eventLabel) : <span className="font-normal text-muted2">結果待ち</span>}
                    </span>
                    {!!entry.details?.length && <span className="block basis-full text-micro text-muted2">{entry.details.join(" / ")}</span>}
                  </p>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RESULT_DIVISIONS = ["男子", "女子", "混合", "区分なし"] as const;
type ResultDivision = typeof RESULT_DIVISIONS[number];
type ResultFilter = "all" | Exclude<ResultDivision, "区分なし">;

/** 種目自体の区分で分け、男女混合の組でも男女別の結果・順位は維持する。 */
function resultDivision(eventLabel: string): ResultDivision {
  const label = normalizeEntryName(eventLabel);
  if ((label.includes("男子") && label.includes("女子")) || label.startsWith("男女")) return "混合";
  if (label.startsWith("男子")) return "男子";
  if (label.startsWith("女子")) return "女子";
  if (label.startsWith("混合")) return "混合";
  return "区分なし";
}

/** The same dated event/result list for official feeds, managed meets and member records. */
export function CompetitionResults({ rows }: { rows: ParsedProgramRow[] }) {
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState<ResultFilter>("all");
  const divisions = RESULT_DIVISIONS.filter(value => rows.some(row => resultDivision(row.eventLabel) === value));
  const selectedDivision = division === "all" || divisions.includes(division) ? division : "all";
  const filterItems: { key: ResultFilter; label: string }[] = [
    { key: "all", label: "全て" },
    ...divisions.filter((value): value is Exclude<ResultDivision, "区分なし"> => value !== "区分なし").map(value => ({ key: value, label: value })),
  ];
  const query = normalizeEntryName(search).toLowerCase();
  const groups = groupProgramByDate(rows.flatMap(row => {
    if (selectedDivision !== "all" && resultDivision(row.eventLabel) !== selectedDivision) return [];
    if (!query || normalizeEntryName(row.eventLabel).toLowerCase().includes(query)) return [row];
    const tuatEntries = row.tuatEntries.filter(entry => normalizeEntryName(entry.name + entry.grade).toLowerCase().includes(query));
    return tuatEntries.length ? [{...row,tuatEntries}] : [];
  }));
  if (!rows.length) return <Card><EmptyState title="まだこの大会の結果はありません" /></Card>;
  return <div className="space-y-4">
    {filterItems.length > 1 && <SegmentedControl items={filterItems} value={selectedDivision} onChange={setDivision} />}
    <Input aria-label="大会結果を検索" placeholder="種目・氏名・学年で検索" value={search} onChange={e=>setSearch(e.target.value)} />
    {!groups.length && <Card><EmptyState title="条件に合う結果はありません" /></Card>}
    {groups.map(group => <section key={group.date} className="space-y-3">
      <p className="section-label">{format(new Date(group.date + "T00:00:00"), "M月d日(E)", { locale: ja })}</p>
      {RESULT_DIVISIONS.map(value => {
        const track = group.track.filter(row => resultDivision(row.eventLabel) === value);
        const field = group.field.filter(row => resultDivision(row.eventLabel) === value);
        if (!track.length && !field.length) return null;
        return <div key={value} className="space-y-2">
          {filterItems.length > 1 && <h3 className="text-caption font-semibold text-ink">{value}</h3>}
          {(["track", "field"] as const).map(block => {
            const blockRows = block === "track" ? track : field;
            if (!blockRows.length) return null;
            return <div key={block} className="space-y-1.5">
              <p className="text-caption text-muted">{block === "track" ? "トラック" : "フィールド"}</p>
              <Card className="divide-y divide-separator">{blockRows.map(row => <CompetitionResultRow key={row.roundKey} row={row} />)}</Card>
            </div>;
          })}
        </div>;
      })}
  </section>)}</div>;
}
