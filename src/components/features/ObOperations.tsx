"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ObHeatEditor } from "./ObHeatEditor";
import { ObEventOperationsEditor } from "./ObEventOperationsEditor";
import { compareObEvents } from "@/lib/ob-entry-edit";
import { obEventTime } from "@/lib/ob-meet";
import type { ObEntry } from "@/lib/ob-entries";
import type { EntryMember } from "@/lib/entry-identity";
import type { ObDuty, ObDutyRole } from "@/lib/ob-duty";
import { obEventParticipants, type ObEventOperation } from "@/lib/ob-operations";

type Props = { onlyGroups?: boolean; entries: ObEntry[]; members: EntryMember[]; duties: ObDuty[]; roles: ObDutyRole[]; initial: ObEventOperation[]; canEditDuties?: boolean; onAddEntry?: (event: string) => void };
export function ObOperations({ entries, initial, onlyGroups = false, onAddEntry }: Props) {
  const [local, setSaved] = useState<ObEventOperation[]>([]);
  const [opened, setOpened] = useState<{ event: string; view: "groups" | "records" } | null>(null);
  const router = useRouter();
  const latest = new Map(initial.map(s => [s.event_name, s]));
  for (const value of local) if (!latest.has(value.event_name) || latest.get(value.event_name)!.revision < value.revision) latest.set(value.event_name, value);
  const events = [...new Set([...entries.flatMap(e => e.events), ...latest.keys()])].sort(compareObEvents);
  const families = [...new Set(events.map(e => e.replace(/^(男子|女子)/, "")))];
  const Editor = opened?.view === "groups" ? ObHeatEditor : ObEventOperationsEditor;
  return <div className="space-y-4">
    <p className="text-caption">競技の順に並んでいます。種目を選んで組分け・DNS・記録を操作できます。</p>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">{families.map(family => {
      const names = events.filter(e => e.replace(/^(男子|女子)/, "") === family);
      return <section key={family} aria-label={family} className="min-w-0 overflow-hidden rounded-xl border border-separator bg-card">
        <h3 className="flex items-center gap-3 bg-bg p-3 text-title"><span className="text-caption tabular-nums">{obEventTime(names[0])}</span>{family}</h3>
        <div className="divide-y divide-separator">{names.map(event => {
          const state = latest.get(event), rows = obEventParticipants(event, entries, state?.data);
          const participating = rows.filter(r => r.state.canParticipate);
          const unassigned = participating.filter(r => r.performance.group === null || r.performance.order === null).length;
          const groups = new Set(participating.flatMap(r => r.performance.group !== null ? [r.performance.group] : []));
          const recorded = rows.filter(r => r.state.recorded).length;
          const inactive = rows.filter(r => r.state.status !== "entered").length;
          return <div key={event} className="space-y-3 p-3"><div className="flex items-start justify-between gap-2"><div><h4 className="text-headline">{event.startsWith("女子") ? "女子" : "男子"} <span className="text-caption">出場 {participating.length}人</span></h4><p className="mt-1 text-caption">{groups.size ? `${groups.size}組` : "組分け前"}{inactive ? ` · DNS・欠席など ${inactive}人` : ""}{!onlyGroups ? ` · 記録 ${recorded}人${state?.data.confirmed ? " · 確認済み" : ""}` : ""}</p></div>{unassigned > 0 && <span className="rounded-md bg-accent/10 px-2 py-1 text-caption text-accent">組未定 {unassigned}人</span>}</div><div className={`grid gap-2 ${onlyGroups ? "grid-cols-1" : "grid-cols-2"}`}><Button variant="outline" aria-label={`${event}の組分け`} onClick={() => setOpened({ event, view: "groups" })}>組分け・DNS</Button>{!onlyGroups && <Button variant="outline" aria-label={`${event}の記録`} onClick={() => setOpened({ event, view: "records" })}>記録</Button>}</div></div>;
        })}</div>
      </section>;
    })}</div>
    {!events.length && <div className="rounded-xl border border-separator p-6 text-center"><p className="text-body">出場登録がある種目はありません</p>{onAddEntry && <Button className="mt-3" onClick={() => onAddEntry("")}>出場者を追加</Button>}</div>}
    {opened && <Editor key={`${opened.event}:${opened.view}`} event={opened.event} entries={entries} initial={latest.get(opened.event)} onAddEntry={onAddEntry} onSaved={value => { setSaved(current => [...current.filter(s => s.event_name !== value.event_name), value]); router.refresh(); }} onClose={() => setOpened(null)}/>}
  </div>;
}
