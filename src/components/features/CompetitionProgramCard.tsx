"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { jstNow, jstToday } from "@/lib/date";
import {
  currentProgramRow,
  formatAthleteList,
  formatProgramEventLabel,
  fromStoredProgramRow,
  type ParsedProgramRow,
} from "@/lib/competition-program";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

function hhmm(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * ホーム最上部の大会プログラムカード。普段は出場予定人数だけの静かな札だが、
 * 大会当日、いま行われている種目に農工大の出場者がいる間だけ、その種目名と
 * 出場者を小さく2行まで足して縦に伸びる（トラック・フィールドを別々に判定）。
 */
export function CompetitionProgramCard({
  competition,
  entries,
}: {
  competition: CompetitionRow;
  entries: CompetitionProgramEntryRow[];
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(jstNow());
    update();
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  if (entries.length === 0) return null;
  const rows = entries.map(fromStoredProgramRow);
  const today = jstToday();
  const nowLabel = now ? hhmm(now) : null;
  const track = nowLabel ? currentProgramRow(rows, today, nowLabel, "track") : null;
  const field = nowLabel ? currentProgramRow(rows, today, nowLabel, "field") : null;
  const totalAthletes = new Set(rows.flatMap((row) => row.tuatEntries.map((e) => `${e.grade}${e.name}`))).size;

  return (
    <Link
      href={`/competitions/${competition.id}/program`}
      aria-label={`${competition.name}のプログラムを開く`}
      className="relative block overflow-hidden rounded-[16px] bg-[#1c1c1e] p-4 text-white transition-active active:bg-[#2a2a2e]"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,#4a8ae4,#8a5ad0,#e878c0)]"
      />
      <p className="flex items-center justify-between gap-1 text-caption text-white/70">
        <span className="truncate">{competition.name}プログラム</span>
        <ChevronRight size={14} className="shrink-0" />
      </p>
      {track || field ? (
        <div className="mt-1.5 space-y-1">
          {track && <ProgramLine label="トラック" row={track} />}
          {field && <ProgramLine label="フィールド" row={field} />}
        </div>
      ) : (
        <p className="mt-1">
          <span className="text-large-title tabular-nums">{totalAthletes}</span>
          <span className="ml-1 text-body text-white/60">名 出場予定</span>
        </p>
      )}
    </Link>
  );
}

function ProgramLine({ label, row }: { label: string; row: ParsedProgramRow }) {
  return (
    <p className="truncate text-[12px] text-white/80">
      <span className="mr-1 text-white/50">{label}</span>
      {formatProgramEventLabel(row.eventLabel)} 競技中
      <span className="ml-1 font-semibold text-white">{formatAthleteList(row.tuatEntries)}</span>
    </p>
  );
}
