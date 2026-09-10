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
 * 下に続く練習系のカードは白地の四角。ここだけは「いつもと少し違う」ものとして、
 * 濃い地に細い縁を置いた対の札にする。並び・大きさ・角の丸みは他のカードと同じなので、
 * 画面の中で浮かずに、そこだけ手前にあるように見える。
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
  const days = competitionDays(competition.starts_on, today);

  return (
    <section aria-label={`${competition.name}`} className="grid grid-cols-2 gap-3">
      <MeetTile
        href={`/competitions/${competition.id}`}
        label={days >= 0 ? `${competition.name}まで` : competition.name}
        ariaLabel={`${competition.name}のページを開く`}
      >
        {days > 0 ? (
          <>
            <span className="text-large-title tabular-nums">{days}</span>
            <span className="ml-1 text-body text-white/60">日</span>
          </>
        ) : days === 0 ? (
          <span className="text-title2">いよいよ今日</span>
        ) : (
          <span className="text-title2">開幕しました</span>
        )}
      </MeetTile>

      <MeetTile
        href={`/competitions/${competition.id}/goals`}
        label={`${competition.name}の目標`}
        ariaLabel={`${competition.name}の目標を開く`}
      >
        <span className="text-large-title tabular-nums">{goalCount}</span>
        <span className="ml-1 text-body text-white/60">件</span>
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
      className="relative block overflow-hidden rounded-[16px] bg-[#1c1c1e] p-4 text-white transition-active active:bg-[#2a2a2e]"
    >
      {/* 上端の細い光。起動画面の下線と同じ色づかいで、大会まわりだと分かるようにする。 */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,#4a8ae4,#8a5ad0,#e878c0)]"
      />
      <p className="flex items-center justify-between gap-1 text-caption text-white/70">
        <span className="truncate">{label}</span>
        <ChevronRight size={14} className="shrink-0" />
      </p>
      <p className="mt-1">{children}</p>
    </Link>
  );
}
