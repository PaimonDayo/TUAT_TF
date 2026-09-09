"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { competitionDays } from "@/lib/competition";
import { jstToday } from "@/lib/date";
import type { CompetitionRow } from "@/types";

/**
 * ホーム最上部の大会カード。出すのはカウントダウンだけ。
 * 目標はマイページ→目標が入口で、ここには混ぜない。大会の管理は管理メニューの /competitions。
 */
export function CompetitionHome({
  competition,
  initialToday,
}: {
  competition: CompetitionRow;
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
    <section aria-label="大会のカウントダウン">
      <Card>
        <Link
          href={`/competitions/${competition.id}`}
          className="flex items-center gap-3 p-4 active:opacity-70"
          aria-label={`${competition.name}のページを開く`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-caption">{competition.name}まで</p>
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
          </div>
          <ChevronRight size={18} className="shrink-0 text-muted" />
        </Link>
      </Card>
    </section>
  );
}
