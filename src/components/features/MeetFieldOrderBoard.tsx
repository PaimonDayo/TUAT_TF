"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ReorderList } from "@/components/ui/reorder-list";
import { MeetFieldPlan, fieldOrderRows } from "@/lib/meet-field-order";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import type { MeetEventData, MeetPerformance } from "@/lib/meet-operations";

type FieldEntrant = { id: string; name: string; grade: string; mark: string; alumni: boolean; eligible: boolean; absent?: boolean };
type FieldRow = { id: string; person: MeetPerformance; number: number | null; locked: boolean };

export function MeetFieldOrderBoard({ data, entrants, disabled, onChange }: {
  data: MeetEventData; entrants: FieldEntrant[]; disabled: boolean; onChange: (data: MeetEventData) => void;
}) {
  const [past, setPast] = useState<MeetEventData[]>([]);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const people = new Map(entrants.map(entry => [entry.id, entry]));
  const eligible = new Set(entrants.filter(entry => entry.eligible && !entry.absent).map(entry => entry.id));
  const model = new MeetFieldPlan(data, eligible);
  const active = (person: MeetPerformance) => eligible.has(person.entryId) && person.status === "entered";
  const rows: FieldRow[] = model.rows.map(row => ({ ...row, id: row.person.entryId, locked: !active(row.person) }));
  const unplacedInactive = fieldOrderRows(data).filter(row => row.number === null && !active(row.person));

  function change(run: () => MeetEventData, success: string) {
    try {
      const next = run();
      if (next !== data) { setPast(current => [...current, data]); onChange(next); setMessage(success); }
      else setMessage("");
      setFailed(false);
    } catch (error) { setMessage((error as Error).message); setFailed(true); }
  }
  function row(person: MeetPerformance, number: number | null) {
    const entry = people.get(person.entryId), name = entry?.name ?? "登録解除済み";
    const editable = active(person);
    const reason = entry?.absent ? "大会欠席" : !entry?.eligible ? "出場取消" : person.status === "DNS" ? "DNS" : person.status;
    const marks = person.trials.map((trial, index) => {
      const result = trial.status === "foul" ? "失敗" : trial.status === "pass" ? "パス" : "";
      return trial.mark || result ? `${index + 1}回目 ${trial.mark}${trial.wind ? `（風速 ${trial.wind}）` : ""}${result ? ` ${result}` : ""}` : "";
    }).filter(Boolean);
    return <div role="listitem" className="flex min-h-16 items-center gap-2 border-b border-separator bg-card p-2">
      <span aria-label={`${name}の試技順`} className={`w-12 shrink-0 text-center ${number === null ? "text-caption text-ink/75" : "text-body tabular-nums"}`}>{number === null ? "順番未定" : `${number}番`}</span>
      <div className="min-w-0 flex-1"><p className={`break-words text-body font-medium ${entry?.alumni ? "text-violet-700" : ""}`}>{name}</p><p className="text-caption">{entry?.grade}{entry?.mark ? ` · 資格記録 ${entry.mark}` : ""}</p>{!!marks.length && <p className="break-words text-caption">{marks.join("、")}</p>}{!editable && <p className="text-caption text-ink/75">{reason}{number !== null ? " · 順番を保持" : ""}</p>}{eligible.has(person.entryId) && person.status === "DNS" && <Button size="sm" variant="ghost" className="min-h-11 px-2" disabled={disabled} aria-label={`${name}を出場に戻す`} onClick={() => change(() => new MeetHeatPlan(data, eligible).setDns(person.entryId, false), `${name}を出場に戻しました`)}>出場に戻す</Button>}</div>
      {editable && <Button size="sm" variant="ghost" className="min-h-11 shrink-0 px-2 text-muted2" disabled={disabled} aria-label={`${name}をDNSにする`} onClick={() => change(() => new MeetHeatPlan(data, eligible).setDns(person.entryId, true), `${name}をDNSにしました`)}>DNS</Button>}
    </div>;
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-caption">左のつまみを上下に動かして試技順を決めてください。</p><div className="flex flex-wrap gap-1">{rows.some(item => item.number === null && !item.locked) && <Button size="sm" variant="outline" disabled={disabled} onClick={() => change(() => model.assignOrder(), "試技順を決めました")}>この順番で決める</Button>}<Button size="sm" variant="ghost" disabled={disabled || !past.length} onClick={() => { onChange(past.at(-1)!); setPast(past.slice(0, -1)); setMessage(""); setFailed(false); }}>元に戻す</Button></div></div>
    {message && <p role={failed ? "alert" : "status"} aria-live="polite" className={`rounded-lg bg-bg p-3 text-body ${failed ? "text-danger" : ""}`}>{message}</p>}
    <section aria-label="試技順の出場者" className="overflow-hidden rounded-xl border border-separator bg-card">
      <h3 className="bg-bg p-3 text-headline">試技順 <span className="text-caption">{rows.length}人</span></h3>
      <div role="list"><ReorderList items={rows} enabled={!disabled} isItemDisabled={item => item.locked} getDragLabel={item => `${item.number === null ? "順番未定" : `試技順${item.number}番`}の${people.get(item.id)?.name ?? "出場者"}をスライドして並べ替え`} onReorder={next => change(() => model.reorder(next.filter(item => !item.locked).map(item => item.id)), "試技順を変更しました")} renderItem={item => row(item.person, item.number)}/></div>
      {!rows.length && <p className="p-6 text-center text-body">出場予定の人はいません</p>}
    </section>
    {!!unplacedInactive.length && <section aria-label="順番未定のDNS・欠席・出場取消" className="overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">DNS・欠席など <span className="text-caption">{unplacedInactive.length}人</span></h3><div role="list">{unplacedInactive.map(item => <div key={item.person.entryId}>{row(item.person, null)}</div>)}</div></section>}
  </div>;
}
