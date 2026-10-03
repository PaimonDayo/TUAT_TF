"use client";

import { AlertCircle, ChevronRight } from "lucide-react";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";

export function ObDutyIssues({ issues, onOpen }: { issues: ObDutyIssue[]; onOpen: (time: string, event: string) => void }) {
  if (!issues.length) return <p className="text-caption">補助担当の重複・人数不足はありません。競技終了・アップ・移動の時間は別途確認してください。</p>;
  const slots = [...new Set(issues.map(issue => `${issue.time}/${issue.event}`))];
  return <section aria-label="補助員の確認事項" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
    <h2 className="flex items-center gap-2 text-headline text-danger"><AlertCircle size={18} aria-hidden />補助員の確認が必要：{slots.length}種目</h2>
    <p className="mt-1 text-caption">問題のある種目を押して、担当者を確認してください。</p>
    <div className="mt-2 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">{slots.map(key => {
      const group = issues.filter(issue => `${issue.time}/${issue.event}` === key);
      return <button key={key} type="button" className="flex min-h-12 items-start gap-2 rounded-lg bg-card p-3 text-left pressable" onClick={() => onOpen(group[0].time, group[0].event)}>
        <span aria-hidden className="font-bold text-danger">！</span><span className="min-w-0 flex-1"><span className="block font-semibold">{group[0].time} {group[0].event}</span>{group.map(issue => <span key={issue.key} className="mt-1 block break-words text-caption">{issue.text}</span>)}</span><ChevronRight size={18} aria-hidden className="shrink-0" />
      </button>;
    })}</div>
  </section>;
}
