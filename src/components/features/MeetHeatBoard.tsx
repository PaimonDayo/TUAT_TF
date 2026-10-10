"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";
import { ReorderList } from "@/components/ui/reorder-list";
import { Select } from "@/components/ui/select";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import type { MeetEventData, MeetOperationLimits, MeetPerformance } from "@/lib/meet-operations";

export type HeatEntrant = { id: string; name: string; grade: string; mark: string; alumni: boolean; eligible: boolean; absent?: boolean; division?: "男子" | "女子" };
type HeatSlot = { id: string; order: number; person?: MeetPerformance; locked: boolean };

export function MeetHeatBoard({ data, entrants, orderLabel, capacity, disabled, onChange, groupLabel = group => `${group}組`, nextGroup: requestedNextGroup, groupLimit = 99, modelLimits, statusActions = true }: { statusActions?: boolean; data: MeetEventData; entrants: HeatEntrant[]; orderLabel: string; capacity?: number; disabled: boolean; onChange: (data: MeetEventData) => void; groupLabel?: (group: number) => string; nextGroup?: number | null; groupLimit?: number; modelLimits?: MeetOperationLimits }) {
  const anchor = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [past, setPast] = useState<MeetEventData[]>([]);
  const [emptyGroups, setEmptyGroups] = useState<number[]>([]);
  const [destination, setDestination] = useState("");
  const [message, setMessage] = useState("");
  const people = new Map(entrants.map(person => [person.id, person]));
  const labelledName = (id: string, fallback = "出場者") => { const entry = people.get(id), name = entry?.name ?? fallback; return entry?.division ? `${entry.division} ${name}` : name; };
  const eligible = new Set(entrants.filter(person => person.eligible && !person.absent).map(person => person.id));
  const model = new MeetHeatPlan(data, eligible, modelLimits);
  const present = model.active;
  const savedGroups = data.participants.flatMap(person => person.group !== null ? [person.group] : []);
  const groups = [...new Set([...savedGroups, ...emptyGroups, ...(!savedGroups.length && !emptyGroups.length ? [requestedNextGroup ?? 1] : [])])].sort((a, b) => a - b);
  let nextGroup = requestedNextGroup === null ? groupLimit + 1 : requestedNextGroup ?? Math.max(0, ...groups) + 1;
  while (groups.includes(nextGroup) && nextGroup <= groupLimit) nextGroup++;
  const ids = selected.filter(id => present.some(person => person.entryId === id));
  const unplacedInactive = data.participants.filter(person => (!eligible.has(person.entryId) || person.status !== "entered") && (person.group === null || person.order === null));
  const positions = new Map<string, number>();
  for (const person of data.participants) if (person.group !== null && person.order !== null) {
    const position = `${person.group}:${person.order}`;
    positions.set(position, (positions.get(position) ?? 0) + 1);
  }
  function change(action: () => MeetEventData, success = "") {
    try {
      const next = action();
      if (next !== data) { setPast(history => [...history.slice(-29), data]); onChange(next); }
      setSelected([]); setDestination(""); setMessage(next !== data ? success : "");
    } catch (error) { setMessage((error as Error).message); }
  }
  function row(person: MeetPerformance) {
    const entry = people.get(person.entryId), checked = ids.includes(person.entryId);
    const selectable = eligible.has(person.entryId) && person.status === "entered";
    const duplicate = person.group !== null && person.order !== null && (positions.get(`${person.group}:${person.order}`) ?? 0) > 1;
    const reason = entry?.absent ? "大会欠席" : !entry?.eligible ? "DNS" : person.status === "DNS" ? "DNS" : person.status;
    const marks = person.trials.map(trial => trial.mark ? `${trial.mark}${trial.wind ? `（風速 ${trial.wind}）` : ""}` : trial.status === "foul" ? "失敗" : trial.status === "pass" ? "パス" : "").filter(Boolean);
    return <div className={`flex min-h-16 items-center gap-1 border-b border-separator ${checked ? "bg-accent/10" : "bg-card"}`}>
      <label className="flex min-h-16 min-w-0 flex-1 items-center gap-2 p-2">
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={checked} disabled={disabled || !selectable} aria-label={`${labelledName(person.entryId, "登録解除済み")}を選択`} onChange={() => { setSelected(current => checked ? current.filter(id => id !== person.entryId) : [...current, person.entryId]); setMessage(""); }}/>
        <span className="w-5 shrink-0 text-center text-body tabular-nums">{person.order ?? "—"}</span>
        <span className="min-w-0 flex-1"><span className={`block break-words text-body font-medium ${entry?.alumni ? "text-violet-700" : ""}`}>{entry?.name ?? "登録解除済み"}</span><span className="block text-caption">{entry?.division && <span className="font-medium text-ink/75">{entry.division}{entry.grade || entry.mark ? " · " : ""}</span>}{entry?.grade}{entry?.mark ? ` · ${entry.mark}` : ""}</span>{!!marks.length && <span className="block break-words text-caption">記録: {marks.join("、")}</span>}{!selectable && <span className="block text-caption text-ink/75">{reason} · 配置を保持</span>}{duplicate && <span className="block text-caption text-danger">！ {groupLabel(person.group!)}{person.order}番が重複</span>}</span>
      </label>
      <div className="shrink-0 pr-1">
        {statusActions && (selectable ? <Button size="sm" variant="ghost" className="min-h-11 px-2 text-muted2" disabled={disabled} aria-label={`${labelledName(person.entryId)}をDNSにする`} onClick={() => change(() => model.setDns(person.entryId, true), `${labelledName(person.entryId)}をDNSにしました`)}>DNS</Button>
          : eligible.has(person.entryId) && person.status === "DNS" ? <Button size="sm" variant="ghost" className="min-h-11 px-2" disabled={disabled} aria-label={`${labelledName(person.entryId)}を出場に戻す`} onClick={() => change(() => model.setDns(person.entryId, false), `${labelledName(person.entryId)}を出場に戻しました`)}>出場に戻す</Button> : null)}
      </div>
    </div>;
  }
  function groupBoard(group: number) {
    const assigned = data.participants.filter(person => person.group === group && person.order !== null);
    const span = capacity ?? Math.max(1, ...assigned.map(person => person.order!));
    const slots: HeatSlot[] = Array.from({ length: span }, (_, index) => {
      const order = index + 1, person = assigned.find(person => person.order === order);
      return { id: `${group}:${order}`, order, person, locked: !!person && (!eligible.has(person.entryId) || person.status !== "entered") };
    });
    const extra = assigned.filter((person, index) => person.order! > span || assigned.findIndex(other => other.order === person.order) !== index);
    const duplicate = assigned.some(person => (positions.get(`${group}:${person.order}`) ?? 0) > 1);
    return <section key={group} id={`${anchor}-${group}`} aria-label={groupLabel(group)} className="min-w-0 scroll-mt-3 overflow-hidden rounded-xl border border-separator bg-card">
      <h3 className="flex items-center justify-between gap-2 bg-bg px-3 py-3 text-headline"><span>{groupLabel(group)} <span className="text-caption">{present.filter(person => person.group === group && person.order !== null).length}人{capacity ? ` / ${capacity}枠` : ""}</span></span><span className="text-caption">{orderLabel}</span></h3>
      <ReorderList items={slots} enabled={!disabled && !duplicate} isItemDisabled={slot => slot.locked} getDragLabel={slot => `${groupLabel(group)}${slot.order}${orderLabel}の${slot.person ? labelledName(slot.person.entryId) : "空き枠"}をスライドして並べ替え`} onReorder={next => change(() => model.reorder(group, next.filter(slot => !slot.locked).map(slot => slot.order), capacity), `${groupLabel(group)}の順番を変更しました`)} renderItem={slot => slot.person ? row(slot.person) : <div aria-label={`${groupLabel(group)}${slot.order}${orderLabel}の空き枠`} className="flex min-h-16 items-center gap-2 border-b border-separator bg-card p-2"><span className="h-5 w-5 shrink-0"/><span className="w-5 shrink-0 text-center text-body tabular-nums">{slot.order}</span><span className="text-body text-muted2">空き</span></div>}/>
      {!!extra.length && <div className="border-t border-separator p-2"><p className="px-2 py-2 text-caption">保存済みの範囲外・重複した配置</p>{extra.map(person => <div key={person.entryId}>{row(person)}</div>)}</div>}
    </section>;
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-caption">組を移す人をチェック。組内は左のつまみを上下に動かします。</p><div className="flex gap-1"><Button size="sm" variant="outline" disabled={disabled || nextGroup > groupLimit} onClick={() => { setEmptyGroups([...new Set([...groups, nextGroup])]); setMessage(""); }}>新しい組を追加</Button><Button size="sm" variant="ghost" disabled={disabled || !past.length} onClick={() => { onChange(past.at(-1)!); setPast(past.slice(0, -1)); setSelected([]); setMessage(""); }}>元に戻す</Button></div></div>
    {groups.length > 0 && <nav aria-label="組へ移動" className="flex gap-2 overflow-x-auto pb-1">{groups.map(group => <Button key={group} variant="outline" size="sm" className="shrink-0" onClick={() => document.getElementById(`${anchor}-${group}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{groupLabel(group)} · {present.filter(person => person.group === group).length}人</Button>)}</nav>}
    {message && <p role="status" aria-live="polite" className="rounded-lg bg-bg p-3 text-body">{message}</p>}
    {!!model.unassigned.length && <section aria-label="未定の出場者" className="overflow-hidden rounded-xl border-2 border-accent/50"><div className="bg-accent/5 p-3"><h3 className="text-headline">組未定 <span className="text-caption">{model.unassigned.length}人</span></h3><p className="text-caption">追加された人もここに表示します。選んで組へ移してください。</p></div>{model.unassigned.map(person => <div key={person.entryId}>{row(person)}</div>)}</section>}
    <div className={`grid min-w-0 grid-cols-1 items-start gap-4 ${groups.length > 3 ? "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : groups.length === 3 ? "md:grid-cols-2 xl:grid-cols-3" : groups.length === 2 ? "md:grid-cols-2" : ""}`}>{groups.map(groupBoard)}</div>
    {!present.length && <p className="rounded-xl border border-separator p-6 text-center text-body">出場予定の人はいません</p>}
    {!!unplacedInactive.length && <section aria-label="DNS・欠席・出場取消" className="overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">DNS・欠席など <span className="text-caption">{unplacedInactive.length}人</span></h3>{unplacedInactive.map(person => <div key={person.entryId}>{row(person)}</div>)}</section>}
    <FormModalFooter>{ids.length > 0 && <div aria-label="選択した人の移動" className="mb-3 space-y-2 border-b border-separator pb-3"><div className="flex items-center justify-between gap-2"><p role="status" className="text-body font-semibold">{ids.length}人選択中</p><Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setSelected([]); setDestination(""); }}>選択解除</Button></div><div className="flex flex-wrap items-center gap-2"><Select ariaLabel="移動先の組" className="flex-1" value={destination} disabled={disabled} onValueChange={setDestination} options={[{ value: "", label: "移動先を選ぶ" }, ...groups.map(group => ({ value: String(group), label: groupLabel(group) })), { value: "new", label: requestedNextGroup === undefined || nextGroup > groupLimit ? "新しい組" : `${groupLabel(nextGroup)}を新しく作る`, disabled: nextGroup > groupLimit }, { value: "none", label: "組未定に戻す" }]}/><Button disabled={disabled || !destination || destination === "new" && nextGroup > groupLimit} onClick={() => change(() => { const next = model.move(ids, destination === "none" ? null : destination === "new" ? nextGroup : Number(destination), capacity); if (destination === "new") setEmptyGroups([...new Set([...groups, nextGroup])]); return next; }, `${ids.length}人を移動しました`)}>移動</Button></div></div>}</FormModalFooter>
  </div>;
}
