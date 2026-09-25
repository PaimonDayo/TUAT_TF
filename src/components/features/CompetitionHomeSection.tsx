"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isCompetitionArchived } from "@/lib/competition-lifecycle";
import { CompetitionHome } from "./CompetitionHome";
import { CompetitionProgramCard } from "./CompetitionProgramCard";
import type { CompetitionRow, CompetitionProgramEntryRow } from "@/types";

export function CompetitionHomeSection({ competition, entries, goalCount, initialToday }: {
  competition: CompetitionRow; entries: CompetitionProgramEntryRow[]; goalCount: number; initialToday: string;
}) {
  const router = useRouter();
  const [expiredId, setExpiredId] = useState<string | null>(null);
  useEffect(() => {
    let refreshed = false;
    const update = () => {
      if (document.visibilityState !== "visible" || refreshed || !isCompetitionArchived(competition)) return;
      refreshed = true;
      setExpiredId(competition.id);
      router.refresh();
    };
    update();
    const timer = window.setInterval(update, 15_000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [competition, router]);
  return <div className="space-y-2">
    {expiredId !== competition.id && <>
      <CompetitionProgramCard competition={competition} entries={entries} />
      <CompetitionHome competition={competition} goalCount={goalCount} initialToday={initialToday} />
    </>}
    <Link href="/competitions" className="block text-right text-caption text-accent">大会一覧・アーカイブ →</Link>
  </div>;
}
