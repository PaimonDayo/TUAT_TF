"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { jstNow, jstToday } from "@/lib/date";
import { currentProgramRows, nextProgramRows, formatAthleteList, formatProgramEventLabel, fromStoredProgramRow } from "@/lib/competition-program";
import type { CompetitionProgramEntryRow } from "@/types";

/** ホームとプログラムで同じ進行目安を表示する。 */
export function CompetitionInProgress({ entries, dark = false }: { entries: CompetitionProgramEntryRow[]; dark?: boolean }) {
  const router = useRouter();
  const [clock, setClock] = useState<{ today: string; time: string } | null>(null);
  useEffect(() => {
    const update = (refresh: boolean) => {
      if (document.visibilityState !== "visible") return;
      const now = jstNow();
      const today = jstToday();
      setClock({ today, time: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") });
      if (refresh && entries.some(row => row.event_date === today)) router.refresh();
    };
    update(false);
    const resume = () => update(true);
    const timer = window.setInterval(resume, 60_000);
    document.addEventListener("visibilitychange", resume);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [entries, router]);
  const parsed = entries.map(fromStoredProgramRow);
  const panels = [
    { title: "競技中", rows: clock ? currentProgramRows(parsed, clock.today, clock.time) : [], empty: "現在、該当する農工大の出場種目はありません" },
    { title: "次の競技", rows: clock ? nextProgramRows(parsed, clock.today, clock.time) : [], empty: "この先の農工大の出場予定はありません" },
  ];
  const muted = dark ? "text-white/65" : "text-muted2";
  return (
    <div className="space-y-3">{panels.map(({ title, rows, empty }) => <section key={title} aria-label={title} className={dark ? "mt-3 rounded-xl border border-white/20 bg-white/5 p-3" : "rounded-xl border border-accent/30 bg-card p-3.5"}>
      <h2 className="text-headline">{title}</h2>
      <p className={"mt-1 text-micro " + muted}>{title === "競技中" ? "開始予定時刻からの目安です。進行・結果の反映に遅れがあります。" : "農工大の出場予定 · 時刻は開始予定です"}</p>
      {rows.length ? <ul className="mt-3 space-y-3">
        {rows.map(row => <li key={row.eventDate + row.block + row.roundKey}>
          <p className={"text-micro " + muted}>{row.block === "track" ? "トラック" : "フィールド"}</p>
          <p className="flex items-baseline gap-2 text-[13px] font-semibold">
            <span className="shrink-0 tabular-nums">{row.eventDate !== clock?.today && <span className="mr-1">{Number(row.eventDate.slice(5, 7))}/{Number(row.eventDate.slice(8, 10))}</span>}{row.timeLabel}</span>
            <span>{formatProgramEventLabel(row.eventLabel)}</span>
          </p>
          <p className={"mt-0.5 text-[12px] " + muted}>{formatAthleteList(row.tuatEntries)}</p>
        </li>)}
      </ul> : <p className={"mt-2 text-caption " + muted}>{clock ? empty : "時刻を確認しています…"}</p>}
    </section>)}</div>
  );
}
