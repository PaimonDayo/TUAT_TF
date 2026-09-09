"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { competitionDays } from "@/lib/competition";
import { jstToday } from "@/lib/date";
import type { CompetitionRow } from "@/types";

/**
 * ホーム最上部の大会カード（カウントダウンと目標の人数）。
 * 目標の一覧・追加は /competitions/[id]/goals、大会の管理は /competitions で行う。
 */
export function CompetitionHome({
  competition,
  goalCount,
  initialToday,
}: {
  competition: CompetitionRow;
  goalCount: number;
  initialToday: string;
}) {
  const [today, setToday] = useState(initialToday);
  useEffect(() => {
    const update = () => setToday(jstToday());
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const days = competitionDays(competition.starts_on, today);

  return (
    <section aria-label="大会とみんなの目標">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <Link
            href={`/competitions/${competition.id}`}
            className="block p-4 active:opacity-70"
            aria-label={`${competition.name}のページを開く`}
          >
            <p className="flex items-center justify-between gap-1 text-caption">
              <span className="truncate">{competition.name}まで</span>
              <ChevronRight size={14} className="shrink-0" />
            </p>
            <p className="mt-1 text-large-title tabular-nums">
              {days >= 0 ? (
                <>
                  {days}
                  <span className="ml-1 text-body text-muted">日</span>
                </>
              ) : (
                <span className="text-title2">開幕しました</span>
              )}
            </p>
          </Link>
        </Card>
        <Card>
          <Link
            href={`/competitions/${competition.id}/goals`}
            className="block p-4 active:opacity-70"
            aria-label="みんなの目標を開く"
          >
            <p className="flex items-center justify-between gap-1 text-caption">
              <span>みんなの目標</span>
              <ChevronRight size={14} className="shrink-0" />
            </p>
            <p className="mt-1 text-large-title tabular-nums">
              {goalCount}
              <span className="ml-1 text-body text-muted">件</span>
            </p>
          </Link>
        </Card>
      </div>
    </section>
  );
}
