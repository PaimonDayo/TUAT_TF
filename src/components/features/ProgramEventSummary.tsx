import { formatAthleteList, formatProgramEventLabel, type ParsedProgramRow } from "@/lib/competition-program";

/** ホーム・進行状況・一覧で共通の時刻、種目、出場者。 */
export function ProgramEventSummary({ row, dateLabel }: { row: ParsedProgramRow; dateLabel?: string }) {
  return <span className="flex min-w-0 flex-1 items-start gap-3">
    <span className="w-12 shrink-0 pt-0.5 text-caption tabular-nums text-muted2">
      {dateLabel && <span className="block text-micro text-muted">{dateLabel}</span>}
      {row.timeLabel ?? "--:--"}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-headline">{formatProgramEventLabel(row.eventLabel)}</span>
      <span className="mt-1 block text-[13px] leading-relaxed text-muted2">{formatAthleteList(row.tuatEntries)}</span>
    </span>
  </span>;
}
