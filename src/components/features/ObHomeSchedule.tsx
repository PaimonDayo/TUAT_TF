import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
import { OB_PROGRAM, OB_PROGRAM_PATH } from "@/lib/ob-meet";

export type ObHomeDuty = { time: string; event: string; assignment: string };

/** Home shows only the viewer's assignments; the full roster stays on the program page. */
export function ObHomeSchedule({ duties, absent = false }: { duties: ObHomeDuty[] | null; absent?: boolean }) {
  return <div className="mt-4 space-y-3 border-t border-separator pt-3">
    <section aria-label="自分の補助担当" className="space-y-2">
      <h3 className="text-headline">自分の補助担当</h3>
      {absent&&<p className="text-caption">大会欠席のため、以下の補助担当は交代の確認が必要です。</p>}
      {duties === null ? <p className="text-caption">補助担当を取得できませんでした。OB戦の運営用画面から確認してください。</p> : duties.length ? <>
        <ul className="space-y-2">{duties.map(duty => <li key={`${duty.time}/${duty.event}`} className="flex items-baseline gap-3 text-body">
          <span className="w-12 shrink-0 text-caption tabular-nums">{duty.time}</span>
          <div className="min-w-0 flex-1 break-words"><p className="font-medium">{duty.event}</p><p className="text-caption">{duty.assignment}</p></div>
        </li>)}</ul>
        <p className="text-micro text-muted2">種目の開始時刻です。集合時刻は担当者の案内を確認してください。</p>
      </> : <p className="text-caption">補助担当はまだ登録されていません。</p>}
    </section>
    <Disclosure title="プログラム（タイムテーブル）">
      <ul className="divide-y divide-separator">{OB_PROGRAM.map(slot => <li key={slot.time + slot.label} className="flex items-baseline gap-3 py-2 text-body">
        <span className="w-12 shrink-0 text-caption tabular-nums">{slot.time}</span>
        <span className="min-w-0 flex-1 break-words">{slot.label}{slot.note && `（${slot.note}）`}</span>
      </li>)}</ul>
    </Disclosure>
    <Link data-ui-row href={OB_PROGRAM_PATH} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 text-[14px] font-semibold text-accent">
      <span>OB戦を開く</span><ChevronRight size={16} className="shrink-0" />
    </Link>
  </div>;
}
