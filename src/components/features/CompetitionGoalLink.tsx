import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatRecordedOn } from "@/lib/competition-record";
import type { CompetitionRow } from "@/types";

/**
 * 目標ハブの1行（大会名・開催日・自分が設定済みの目標件数）。
 * 押すとその大会の目標ページへ移動し、そこで種目ごとの目標を入力する。
 */
export function CompetitionGoalLink({
  competition,
  count,
}: {
  competition: CompetitionRow;
  count: number;
}) {
  const period =
    competition.ends_on && competition.ends_on !== competition.starts_on
      ? `${formatRecordedOn(competition.starts_on, "day")} 〜 ${formatRecordedOn(competition.ends_on, "day")}`
      : formatRecordedOn(competition.starts_on, "day");

  return (
    <Link
      href={`/competitions/${competition.id}/goals`}
      className="flex items-center gap-3 p-4 active:bg-bg"
    >
      <div className="min-w-0 flex-1">
        <p className="text-headline break-words">{competition.name}</p>
        <p className="text-caption mt-0.5">{period}</p>
      </div>
      <span className="shrink-0 text-caption tabular-nums">
        {count > 0 ? `${count}種目` : "未設定"}
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </Link>
  );
}
