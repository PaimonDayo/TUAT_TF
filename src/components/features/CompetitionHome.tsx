"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { competitionDays } from "@/lib/competition";
import { jstToday } from "@/lib/date";
import type { CompetitionRow } from "@/types";

/**
 * ホーム最上部の大会カード（カウントダウンと目標の件数）。
 *
 * プログラムと同じ白地・細い境界線で揃える。
 * 目標の一覧・追加は /competitions/[id]/goals、大会の管理は管理メニューの /competitions。
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
  const days = competitionDays(competition.starts_on, today, competition.ends_on);

  return (
    <section aria-label={`${competition.name}`} className="grid grid-cols-2 gap-3">
      <MeetTile
        href={`/competitions/${competition.id}`}
        label={days >= 0 ? `${competition.name}まであと` : competition.name}
        ariaLabel={`${competition.name}のページを開く`}
      >
        {days >= 0 ? (
          <>
            <span className="text-large-title tabular-nums">{days}</span>
            <span className="ml-1 text-body text-muted">日</span>
          </>
        ) : (
          <span className="text-title2">終了しました</span>
        )}
      </MeetTile>

      <MeetTile
        href={`/competitions/${competition.id}/goals`}
        label={`${competition.name}の目標`}
        ariaLabel={`${competition.name}の目標を開く`}
      >
        <span className="text-large-title tabular-nums">{goalCount}</span>
        <span className="ml-1 text-body text-muted">件</span>
      </MeetTile>
    </section>
  );
}

/** 対の札1枚。中身だけ差し替えて、見た目と操作は必ず揃える。 */
function MeetTile({
  href,
  label,
  ariaLabel,
  children,
}: {
  href: string;
  label: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="block overflow-hidden rounded-2xl border border-separator/70 bg-card p-4 transition-colors active:bg-bg"
    >
      <p className="flex items-center justify-between gap-1 text-caption text-muted2">
        <span className="truncate">{label}</span>
        <ChevronRight size={14} className="shrink-0" />
      </p>
      <p className="mt-1">{children}</p>
    </Link>
  );
}
