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
import { obEventParticipants, obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import { obMixedGroupPosition, projectObMixedEvent } from "@/lib/ob-mixed-operations";
import { obResultSheets, obResultsFileName } from "@/lib/ob-results-sheet";
import { buildXlsx, XLSX_MIME } from "@/lib/xlsx-writer";

type Props = { onlyGroups?: boolean; entries: ObEntry[]; members: EntryMember[]; duties: ObDuty[]; roles: ObDutyRole[]; initial: ObEventOperation[]; canEditGroups?: boolean; canEditDuties?: boolean; onAddEntry?: (event: string) => void };
export function ObOperations({ entries, initial, onlyGroups = false, canEditGroups = true, onAddEntry }: Props) {
  const [local, setSaved] = useState<ObEventOperation[]>([]);
  const [opened, setOpened] = useState<{ family: string; view: "groups" } | { event: string; view: "records" } | null>(null);
  const router = useRouter();
  const latest = new Map(initial.map(s => [s.event_name, s]));
  for (const value of local) if (!latest.has(value.event_name) || latest.get(value.event_name)!.revision < value.revision) latest.set(value.event_name, value);
  const events = [...new Set([...entries.flatMap(e => e.events), ...latest.keys()])].sort(compareObEvents);
  const families = [...new Set(events.map(e => e.replace(/^(男子|女子)/, "")))];
  const [exportError, setExportError] = useState("");
  function saved(values: ObEventOperation[]) {
    const updated = new Set(values.map(value => value.event_name));
    setSaved(current => [...current.filter(value => !updated.has(value.event_name)), ...values]);
    router.refresh();
  }
  /** Reads only what this screen already shows; nothing is saved or re-placed. */
  function download() {
    try {
      const blob = new Blob([buildXlsx(obResultSheets(entries, [...latest.values()])).slice().buffer], { type: XLSX_MIME });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = obResultsFileName(new Date()); a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportError("");
    } catch { setExportError("ファイルを作れませんでした。画面を開き直してからもう一度お試しください"); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 flex-1 basis-60 text-caption">{canEditGroups ? "競技の順に並んでいます。種目を選んで組分け・試技順・DNS・記録を操作できます。" : "種目を選んで記録を入力できます。補助員の割当がなくても入力できます。"}</p>{events.length > 0 && <Button size="sm" variant="outline" className="shrink-0" onClick={download}>スプレッドシートに出力</Button>}</div>
    {events.length > 0 && <p className="text-micro text-muted2">組と記録を種目ごとのシートに分けて保存します。Excel形式で、Googleスプレッドシートでも開けます。</p>}
    {exportError && <p role="alert" className="text-body text-danger">{exportError}</p>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">{families.map(family => {
      const names = events.filter(e => e.replace(/^(男子|女子)/, "") === family);
      const field = obEventRule(family).discipline !== "track";
      const projection = projectObMixedEvent(family, entries, [...latest.values()]);
      const groups = [...new Set(projection.data.participants.flatMap(person => person.group === null ? [] : [person.group]))];
      const groupSummary = (["男子", "女子", "混合"] as const).map(scope => ({ scope, count: groups.filter(group => obMixedGroupPosition(group).heatScope === scope).length })).filter(value => value.count).map(value => `${value.scope} ${value.count}組`).join(" · ");
      return <section key={family} aria-label={family} className="min-w-0 overflow-hidden rounded-xl border border-separator bg-card">
        <h3 className="flex items-center gap-3 bg-bg p-3 text-title"><span className="text-caption tabular-nums">{obEventTime(names[0])}</span>{family}</h3>
        <div className="divide-y divide-separator">{names.map(event => {
          const state = latest.get(event), rows = obEventParticipants(event, entries, state?.data);
          const participating = rows.filter(r => r.state.canParticipate);
          const unassigned = participating.filter(r => r.performance.group === null || r.performance.order === null).length;
          const recorded = rows.filter(r => r.state.recorded).length;
          const inactive = rows.filter(r => r.state.status !== "entered").length;
          return <div key={event} className="space-y-3 p-3"><div className="flex items-start justify-between gap-2"><div><h4 className="text-headline">{event.startsWith("女子") ? "女子" : "男子"} <span className="text-caption">出場 {participating.length}人</span></h4><p className="mt-1 text-caption">{inactive ? `DNS・欠席など ${inactive}人` : ""}{!onlyGroups ? `${inactive ? " · " : ""}記録 ${recorded}人${state?.data.confirmed ? " · 確認済み" : ""}` : ""}</p></div>{unassigned > 0 && <span className="rounded-md bg-accent/10 px-2 py-1 text-caption text-accent">{field ? "順番未定" : "組未定"} {unassigned}人</span>}</div>{!onlyGroups && <Button variant="outline" className="w-full" aria-label={`${event}の記録`} onClick={() => setOpened({ event, view: "records" })}>{event.startsWith("女子") ? "女子" : "男子"}の記録</Button>}</div>;
        })}</div>
        {canEditGroups && <div className="space-y-2 border-t border-separator p-3">{!field && <p className="text-caption" aria-label="保存されている組">{groups.length ? groupSummary : "組分け前"}</p>}<Button variant="outline" className="w-full" aria-label={`${family}の${field ? "試技順" : "組分け"}`} onClick={() => setOpened({ family, view: "groups" })}>{field ? "試技順・DNS" : "組分け・DNS"}</Button></div>}
      </section>;
    })}</div>
    {!events.length && <div className="rounded-xl border border-separator p-6 text-center"><p className="text-body">出場登録がある種目はありません</p>{onAddEntry && <Button className="mt-3" onClick={() => onAddEntry("")}>出場者を追加</Button>}</div>}
    {opened?.view === "groups" && <ObHeatEditor key={`${opened.family}:groups`} family={opened.family} entries={entries} initial={[...latest.values()]} onAddEntry={onAddEntry} onSaved={saved} onClose={() => setOpened(null)}/>}
    {opened?.view === "records" && <ObEventOperationsEditor key={`${opened.event}:records`} event={opened.event} entries={entries} initial={latest.get(opened.event)} operations={[...latest.values()]} onAddEntry={onAddEntry} onSaved={value => saved([value])} onClose={() => setOpened(null)}/>}
  </div>;
}
