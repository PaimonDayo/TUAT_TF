"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fromStoredProgramRow } from "@/lib/competition-program";
import { CompetitionInProgress } from "./CompetitionInProgress";
import { useCompetitionProgram } from "./useCompetitionProgram";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

export function CompetitionProgramCard({
  competition,
  entries: initialEntries,
}: {
  competition: CompetitionRow;
  entries: CompetitionProgramEntryRow[];
}) {
  const entries = useCompetitionProgram(competition, initialEntries);
  if (entries.length === 0) return null;
  const rows = entries.map(fromStoredProgramRow);
  const totalAthletes = new Set(rows.flatMap((row) => row.tuatEntries.map((e) => `${e.grade}${e.name}`))).size;

  return (
    <Link
      href={`/competitions/${competition.id}/program`}
      aria-label={`${competition.name}のプログラムを開く`}
      className="block overflow-hidden rounded-card border border-separator bg-card p-4 transition-colors active:bg-bg"
    >
      <p className="flex items-center justify-between gap-2 text-headline">
        <span className="truncate">{competition.name}</span>
        <span className="flex shrink-0 items-center text-caption font-normal text-accent">プログラム<ChevronRight size={14} /></span>
      </p>
      <p className="mb-4 mt-1 text-caption text-muted">{totalAthletes}名 出場予定</p>
      <CompetitionInProgress entries={entries} />
    </Link>
  );
}
