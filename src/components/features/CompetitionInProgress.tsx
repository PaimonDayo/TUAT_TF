"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { jstNow, jstToday } from "@/lib/date";
import { currentProgramRows, nextProgramRows, fromStoredProgramRow } from "@/lib/competition-program";
import { ProgramEventSummary } from "./ProgramEventSummary";
import type { CompetitionProgramEntryRow } from "@/types";

/** ホームとプログラムで同じ進行目安を表示する。 */
export function CompetitionInProgress({ entries }: { entries: CompetitionProgramEntryRow[] }) {
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
  return (
    <div className="rounded-xl bg-bg px-3.5"><div className="divide-y divide-separator">{panels.map(({ title, rows, empty }) => <section key={title} aria-label={title} className="py-3.5">
      <h2 className="text-caption font-semibold text-muted2">{title}</h2>
      {rows.length ? <ul className="mt-3 space-y-3">
        {rows.map(row => <li key={row.eventDate + row.block + row.roundKey}>
          <ProgramEventSummary row={row} dateLabel={row.eventDate !== clock?.today ? `${Number(row.eventDate.slice(5, 7))}/${Number(row.eventDate.slice(8, 10))}` : undefined} />
        </li>)}
      </ul> : <p className="mt-2 text-caption text-muted">{clock ? empty : "時刻を確認しています…"}</p>}
    </section>)}</div><p className="border-t border-separator py-2.5 text-micro text-muted">開始予定時刻に基づく目安です</p></div>
  );
}
