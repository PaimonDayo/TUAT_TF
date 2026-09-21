"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fromStoredProgramRow } from "@/lib/competition-program";
import { CompetitionInProgress } from "./CompetitionInProgress";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

export function CompetitionProgramCard({
  competition,
  entries,
}: {
  competition: CompetitionRow;
  entries: CompetitionProgramEntryRow[];
}) {
  if (entries.length === 0) return null;
  const rows = entries.map(fromStoredProgramRow);
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
      <p className="mt-1 text-caption text-white/60">{totalAthletes}名 出場予定</p>
      <CompetitionInProgress entries={entries} dark />
    </Link>
  );
}
