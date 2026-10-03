"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import type { MeetEventData, MeetPerformance } from "@/lib/meet-operations";

export type HeatEntrant = { id: string; name: string; grade: string; mark: string; alumni: boolean; eligible: boolean; absent?: boolean };

export function MeetHeatBoard({ data, entrants, orderLabel, disabled, onChange }: { data: MeetEventData; entrants: HeatEntrant[]; orderLabel: string; disabled: boolean; onChange: (data: MeetEventData) => void }) {
  const anchor = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [past, setPast] = useState<MeetEventData[]>([]);
  const [destination, setDestination] = useState("");
  const [message, setMessage] = useState("");
  const people = new Map(entrants.map(p => [p.id, p]));
  const eligible = new Set(entrants.filter(p => p.eligible && !p.absent).map(p => p.id));
  const model = new MeetHeatPlan(data, eligible);
  const present = model.active;
  const groups = [...new Set(present.flatMap(p => p.group !== null && p.order !== null ? [p.group] : []))].sort((a, b) => a - b);
  const nextGroup = Math.max(0, ...data.participants.map(p => p.group ?? 0)) + 1;
  const ids = selected.filter(id => present.some(p => p.entryId === id));
  const inactive = data.participants.filter(p => !eligible.has(p.entryId) || p.status !== "entered");
  const positions = new Map<string, number>();
  for (const person of data.participants) if (person.group !== null && person.order !== null && person.status !== "DNS") {
    const position = `${person.group}:${person.order}`;
    positions.set(position, (positions.get(position) ?? 0) + 1);
  }
  function change(action: () => MeetEventData, success = "") {
    try {
      const next = action();
      if (next !== data) { setPast(history => [...history.slice(-29), data]); onChange(next); }
      setSelected([]); setDestination(""); setMessage(success);
    } catch (error) { setMessage((error as Error).message); }
  }
  function row(p: MeetPerformance, selectable = true) {
    const entry = people.get(p.entryId), checked = ids.includes(p.entryId);
    const duplicate = p.status !== "DNS" && (positions.get(`${p.group}:${p.order}`) ?? 0) > 1;
    const reason = entry?.absent ? "大会欠席" : !entry?.eligible ? "出場取消" : p.status === "DNS" ? "DNS" : p.status;
    return <div key={p.entryId} className={`flex min-h-16 items-center gap-1 border-b border-separator last:border-0 ${checked ? "bg-accent/10" : "bg-card"}`}>
      <button type="button" disabled={disabled || !selectable} aria-pressed={selectable ? checked : undefined} aria-label={`${entry?.name ?? "登録解除済み"}を選択`} onClick={() => { setSelected(current => checked ? current.filter(id => id !== p.entryId) : [...current, p.entryId]); setMessage(""); }} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 p-3 text-left disabled:cursor-default">
        {selectable && <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-white" : "border-muted2"}`}>{checked ? "✓" : ""}</span>}
        <span className="w-7 shrink-0 text-center text-body tabular-nums">{p.group !== null ? p.order : "—"}</span>
        <span className="min-w-0 flex-1"><span className={`block break-words text-body font-medium ${entry?.alumni ? "text-violet-700" : ""}`}>{entry?.name ?? "登録解除済み"}</span><span className="block text-caption">{entry?.grade}{entry?.mark ? ` · ${entry.mark}` : ""}{!selectable && p.group !== null ? ` · ${p.group}組${p.order ?? "—"}番` : ""}</span>{duplicate && <span className="block text-caption text-danger">！ {p.group}組{p.order}番が重複</span>}</span>
      </button>
      <div className="shrink-0 pr-2">
        {selectable && p.status === "entered" ? <Button size="sm" variant="ghost" className="min-h-11 text-muted2" disabled={disabled} aria-label={`${entry?.name ?? "出場者"}をDNSにする`} onClick={() => change(() => model.setDns(p.entryId, true), `${entry?.name ?? "出場者"}をDNSにしました`)}>DNSにする</Button>
          : !selectable ? <div className="text-right"><span className="block text-caption">{reason}</span>{eligible.has(p.entryId) && p.status === "DNS" && <Button size="sm" variant="ghost" className="min-h-11" disabled={disabled} aria-label={`${entry?.name ?? "出場者"}を出場に戻す`} onClick={() => change(() => model.setDns(p.entryId, false), `${entry?.name ?? "出場者"}を出場に戻しました`)}>出場に戻す</Button>}</div>
          : <span className="text-caption">{p.status}</span>}
      </div>
    </div>;
  }
  return <div className="space-y-4">
    <div className="flex items-start justify-between gap-3"><p className="text-caption">名前を選んで組を移動。2人選ぶと入れ替えできます。</p><Button size="sm" variant="ghost" disabled={disabled || !past.length} onClick={() => { onChange(past.at(-1)!); setPast(past.slice(0, -1)); setSelected([]); setMessage(""); }}>元に戻す</Button></div>
    {groups.length > 1 && <nav aria-label="組へ移動" className="flex gap-2 overflow-x-auto pb-1">{groups.map(group => <Button key={group} variant="outline" size="sm" onClick={() => document.getElementById(`${anchor}-${group}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{group}組 · {present.filter(p => p.group === group).length}人</Button>)}</nav>}
    {message && <p role="status" aria-live="polite" className="rounded-lg bg-bg p-3 text-body">{message}</p>}
    {!!model.unassigned.length && <section aria-label="未定の出場者" className="overflow-hidden rounded-xl border-2 border-accent/50"><div className="bg-accent/5 p-3"><h3 className="text-headline">組未定 <span className="text-caption">{model.unassigned.length}人</span></h3><p className="text-caption">追加された人もここに表示します。選んで組へ移してください。</p></div>{model.unassigned.map(p => row(p))}</section>}
    <div className={`grid min-w-0 grid-cols-1 items-start gap-4 ${groups.length > 3 ? "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : groups.length === 3 ? "md:grid-cols-2 xl:grid-cols-3" : groups.length === 2 ? "md:grid-cols-2" : ""}`}>{groups.map(group => <section key={group} id={`${anchor}-${group}`} aria-label={`${group}組`} className="min-w-0 scroll-mt-3 overflow-hidden rounded-xl border border-separator"><h3 className="flex items-center justify-between gap-2 bg-bg px-3 py-3 text-headline"><span>{group}組 <span className="text-caption">{present.filter(p => p.group === group && p.order !== null).length}人</span></span><span className="text-caption">{orderLabel}</span></h3><div className={groups.length === 1 ? "grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : groups.length === 2 ? "grid xl:grid-cols-2" : ""}>{present.filter(p => p.group === group && p.order !== null).sort((a, b) => a.order! - b.order!).map(p => row(p))}</div></section>)}</div>
    {!present.length && <p className="rounded-xl border border-separator p-6 text-center text-body">出場予定の人はいません</p>}
    {!!inactive.length && <section aria-label="DNS・欠席・出場取消" className="overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">DNS・欠席など <span className="text-caption">{inactive.length}人</span></h3>{inactive.map(p => row(p, false))}</section>}
    <FormModalFooter>{ids.length > 0 && <div aria-label="選択した人の移動" className="mb-3 space-y-2 border-b border-separator pb-3"><div className="flex items-center justify-between gap-2"><p role="status" className="text-body font-semibold">{ids.length}人選択中</p><Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setSelected([]); setDestination(""); }}>選択解除</Button></div><div className="flex flex-wrap items-center gap-2"><select aria-label="移動先の組" className="h-11 min-w-0 flex-1 rounded-xl border border-separator bg-card px-3 text-body" value={destination} disabled={disabled} onChange={e => setDestination(e.target.value)}><option value="">移動先を選ぶ</option>{groups.map(group => <option key={group} value={String(group)}>{group}組</option>)}<option value="new">新しい組</option><option value="none">組未定に戻す</option></select><Button disabled={disabled || !destination} onClick={() => change(() => model.move(ids, destination === "none" ? null : destination === "new" ? nextGroup : Number(destination)), `${ids.length}人を移動しました`)}>移動</Button>{ids.length === 2 && <Button variant="outline" disabled={disabled} onClick={() => change(() => model.swap(ids), "2人を入れ替えました")}>2人を入れ替え</Button>}</div></div>}</FormModalFooter>
  </div>;
}
