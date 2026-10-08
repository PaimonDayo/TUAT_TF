"use client";

import { useState } from "react";
import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MeetEvent, emptyTrial, type MeetEventData, type MeetPerformance, type MeetTrial } from "@/lib/meet-operations";
import { effectiveObParticipation, obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import { type ObEntry } from "@/lib/ob-entries";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import { fieldOrderRows } from "@/lib/meet-field-order";
import { obMixedFieldNumbers, obMixedGroup, obMixedGroupLabel, obMixedLimits, obSourceDivision, projectObMixedEvent, splitObMixedEvent, type ObMixedProjection } from "@/lib/ob-mixed-operations";
import { useObOperationDraft } from "./useObOperationDraft";
import { ObOperationConflict } from "./ObOperationConflict";

const statusLabels = { entered: "出場", DNS: "DNS", DNF: "途中棄権", DQ: "失格" } as const;
export function ObEventOperationsEditor({ event, entries, initial, operations = [], onSaved, onClose, onAddEntry }: { event: string; entries: ObEntry[]; initial?: ObEventOperation; operations?: ObEventOperation[]; onSaved: (saved: ObEventOperation) => void; onClose: () => void; onAddEntry?: (event: string) => void }) {
  const draft = useObOperationDraft(event, entries, initial, onSaved);
  const data = draft.data, rule = obEventRule(event), model = new MeetEvent(rule, data);
  const division = obSourceDivision(event);
  function project(value: MeetEventData) {
    return projectObMixedEvent(event, entries, [...operations.filter(operation => operation.event_name !== event), { meet_key: "ob-2026", event_name: event, data: value, revision: draft.revision ?? 0, updated_at: initial?.updated_at ?? "" }]);
  }
  const projection = project(data);
  const fieldRows = rule.discipline !== "track" ? fieldOrderRows(projection.data) : [];
  const [personId, setPersonId] = useState(() => rule.discipline === "track" ? data.participants[0]?.entryId ?? "" : fieldRows.map(row => projection.sourceById.get(row.person.entryId)!).find(source => source.event === event)?.entryId ?? "");
  const [group, setGroup] = useState<string>("all");
  const [message, setMessage] = useState("");
  const disabled = draft.locked || draft.reviewing;
  const people = new Map(entries.map(e => [e.id, e]));
  const numbersFor = (context: ObMixedProjection) => {
    const numbers = obMixedFieldNumbers(context);
    return new Map([...context.sourceById].filter(([, source]) => source.event === event).map(([id, source]) => [source.entryId, numbers.get(id) ?? null]));
  };
  const fieldNumbers = numbersFor(projection);
  const fieldPlacement = (p: MeetPerformance) => fieldNumbers.get(p.entryId) == null ? "順番未定" : `試技順 ${fieldNumbers.get(p.entryId)}番`;
  const trackPlacement = (p: MeetPerformance) => { const value = obMixedGroup(event, p); return value === null ? "組未定" : `${obMixedGroupLabel(value)} ${p.order ?? "—"}番`; };
  const ordered = rule.discipline === "track" ? [...data.participants].sort((a, b) => (obMixedGroup(event, a) ?? 298) - (obMixedGroup(event, b) ?? 298) || (a.order ?? 601) - (b.order ?? 601)) : fieldRows.map(row => projection.sourceById.get(row.person.entryId)!).filter(source => source.event === event).map(source => source.person);
  const groups = [...new Set(ordered.map(p => obMixedGroup(event, p)).filter((g): g is number => g !== null))];
  const visible = ordered.filter(p => rule.discipline !== "track" || group === "all" || String(obMixedGroup(event, p)) === group);
  const person = visible.find(p => p.entryId === personId) ?? visible[0];
  const stateOf = (p: MeetPerformance) => effectiveObParticipation(event, people.get(p.entryId), p);
  const editable = (p: MeetPerformance) => { const state = stateOf(p); return state.registered && !state.absent; };
  function update(id: string, patch: Partial<MeetPerformance>) {
    setMessage(""); draft.change({ ...data, confirmed: false, participants: data.participants.map(p => p.entryId === id ? { ...p, ...patch } : p) });
  }
  function status(p: MeetPerformance, next: MeetPerformance["status"]) {
    if (next === "entered" && p.status === "DNS") {
      try {
        const id = [...projection.sourceById].find(([, source]) => source.event === event && source.entryId === p.entryId)?.[0];
        if (!id) throw new Error("大会の欠席・出場登録を先に確認してください");
        const eligible = new Set(projection.entrants.filter(entry => entry.eligible && !entry.absent).map(entry => entry.id));
        const restored = new MeetHeatPlan(projection.data, eligible, obMixedLimits).setDns(id, false);
        const value = splitObMixedEvent(projection, restored).find(value => value.event === event);
        if (!value) throw new Error("出場種目を確認してください");
        draft.change(value.data); setMessage("");
      }
      catch (error) { setMessage((error as Error).message); }
    } else update(p.entryId, { status: next });
  }
  function changeTrial(p: MeetPerformance, index: number, patch: Partial<MeetTrial>) {
    const trials = Array.from({ length: Math.max(p.trials.length, index + 1) }, (_, i) => p.trials[i] ?? emptyTrial());
    trials[index] = { ...trials[index], ...patch };
    update(p.entryId, { trials });
  }
  function mark(p: MeetPerformance, index: number, text: string) {
    const trial = p.trials[index] ?? emptyTrial();
    changeTrial(p, index, { mark: text, status: text ? "valid" : "pending", ...(text ? {} : { wind: "" }), ...(rule.discipline === "height" && text && trial.status !== "pending" ? { status: trial.status } : {}) });
  }
  const statusControl = (p: MeetPerformance) => <select aria-label={`${people.get(p.entryId)?.submitted_name ?? "出場者"}の出場状況`} className="h-11 w-full min-w-0 rounded-xl border border-separator bg-card px-2 text-body" disabled={disabled || !editable(p)} value={p.status} onChange={e => status(p, e.target.value as MeetPerformance["status"])}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  const trialCount = rule.discipline === "distance" ? 6 : Math.max(3, person?.trials.length ?? 0);
  const currentNumbers = draft.latestData ? numbersFor(project(draft.latestData)) : null;
  const conflictPosition = (p: MeetPerformance, source: "own" | "current") => {
    if (rule.discipline === "track") return trackPlacement(p);
    const number = (source === "own" ? fieldNumbers : currentNumbers)?.get(p.entryId);
    return number === undefined ? "順番を確認できません" : number === null ? "順番未定" : `試技順 ${number}番`;
  };
  return <FormModal open autoFocus={false} title={`${event} · 記録`} onOpenChange={open => !open && onClose()}>
    <FormDraftGuard dirty={draft.dirty} busy={draft.locked} onSave={draft.save}/>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body">{data.confirmed ? "結果確認済み" : "速報"} · {data.participants.length}人</p>{onAddEntry && <Button variant="outline" disabled={disabled} onClick={() => onAddEntry(event)}>出場者を追加</Button>}</div>
      <ObOperationConflict draft={draft} entries={entries} event={event} positionLabel={conflictPosition}/>
      {rule.discipline === "track" && groups.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="表示する組">{["all", ...groups.map(String)].map(value => <Button key={value} size="sm" className="shrink-0" variant={group === value ? "primary" : "outline"} aria-pressed={group === value} onClick={() => setGroup(value)}>{value === "all" ? "全員" : obMixedGroupLabel(Number(value))}</Button>)}</div>}
      {rule.discipline === "track" ? <>
        <p className="text-caption">タイムを直接入力してください。秒、分:秒に対応しています。</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map(p => {
          const entry = people.get(p.entryId), state = stateOf(p), trial = p.trials[0] ?? emptyTrial();
          return <section key={p.entryId} aria-label={`${entry?.submitted_name ?? "登録解除済み"}の記録`} className="min-w-0 space-y-3 rounded-xl border border-separator bg-card p-3">
            <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-headline">{entry?.submitted_name ?? "登録解除済み"}</h3><p className="text-caption">{division} · {trackPlacement(p)} · {entry?.grade}{state.absent || !state.registered ? ` · ${state.label}` : ""}</p></div><span className="shrink-0 text-headline tabular-nums">{model.best(p)}</span></div>
            <div className={`grid gap-2 ${rule.wind ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-1"}`}><label className="text-caption">タイム<Input aria-label={`${entry?.submitted_name ?? "出場者"}のタイム`} placeholder="4:12.34" inputMode="text" disabled={disabled || !editable(p) || p.status !== "entered"} value={trial.mark} onChange={e => mark(p, 0, e.target.value)}/></label>{rule.wind && <label className="text-caption">風速<Input aria-label={`${entry?.submitted_name ?? "出場者"}の風速`} placeholder="+1.2" inputMode="decimal" disabled={disabled || !editable(p) || p.status !== "entered" || trial.status !== "valid"} value={trial.wind} onChange={e => changeTrial(p, 0, { wind: e.target.value })}/></label>}</div>
            {statusControl(p)}
          </section>;
        })}</div>
      </> : <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(200px,1fr)_minmax(0,3fr)]">
        <div className="overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">試技順</h3><div className="max-h-52 overflow-y-auto md:max-h-[calc(100dvh-240px)]">{visible.map(p => <button key={p.entryId} className={`flex min-h-14 w-full items-center justify-between gap-2 border-b border-separator p-3 text-left last:border-0 ${p.entryId === person?.entryId ? "bg-accent/10" : "bg-card"}`} aria-pressed={p.entryId === person?.entryId} onClick={() => setPersonId(p.entryId)}><span className="min-w-0"><span className="block break-words text-body">{people.get(p.entryId)?.submitted_name ?? "登録解除済み"}</span><span className="block text-caption">{division} · {fieldPlacement(p)}{stateOf(p).absent || !stateOf(p).registered ? ` · ${stateOf(p).label}` : ""}</span></span><span className="shrink-0 text-caption tabular-nums">{model.best(p)}</span></button>)}</div></div>
        {person && <section aria-label="選択した出場者の試技" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-title">{people.get(person.entryId)?.submitted_name ?? "登録解除済み"}</h3><p className="text-body">{division} · {fieldPlacement(person)} · ベスト {model.best(person)}</p></div><div className="w-40">{statusControl(person)}</div></div>
          <p className="text-caption">{rule.discipline === "height" ? "高さをmで入力し、○・×・−を選びます。同じ高さも1試技ずつ記録してください。" : "記録をmで入力してください。失敗は×、パスは−を選びます。"}</p>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{Array.from({ length: trialCount }, (_, index) => {
            const trial = person.trials[index] ?? emptyTrial(), locked = disabled || !editable(person) || person.status !== "entered";
            return <fieldset key={`${person.entryId}:${index}`} disabled={locked} className="min-w-0 space-y-2 rounded-xl border border-separator bg-card p-3"><legend className="px-1 text-body font-semibold">{index + 1}回目</legend><label className="block text-caption">{rule.discipline === "height" ? "高さ（m）" : "記録（m）"}<Input aria-label={`${index + 1}回目の記録`} inputMode="decimal" placeholder="0.00" value={trial.mark} onChange={e => mark(person, index, e.target.value)}/></label><div className="flex gap-2" role="group" aria-label={`${index + 1}回目の結果`}>{([...(rule.discipline === "height" ? ["valid" as const] : []), "foul", "pass"] as const).map(outcome => <Button key={outcome} className="flex-1" size="sm" variant={trial.status === outcome ? "primary" : "outline"} aria-pressed={trial.status === outcome} aria-label={`${index + 1}回目を${outcome === "valid" ? "成功" : outcome === "foul" ? "失敗" : "パス"}`} onClick={() => changeTrial(person, index, { status: trial.status === outcome ? "pending" : outcome, wind: "", ...(rule.discipline !== "height" || trial.status === outcome ? { mark: "" } : {}) })}>{outcome === "valid" ? "○" : outcome === "foul" ? "×" : "−"}</Button>)}</div>{rule.wind && <label className="block text-caption">風速<Input aria-label={`${index + 1}回目の風速`} placeholder="+1.2" inputMode="decimal" value={trial.wind} disabled={trial.status !== "valid"} onChange={e => changeTrial(person, index, { wind: e.target.value })}/></label>}</fieldset>;
          })}</div>
          {rule.discipline === "height" && trialCount < 30 && <Button variant="outline" disabled={disabled || !editable(person) || person.status !== "entered"} onClick={() => update(person.entryId, { trials: [...Array.from({ length: trialCount }, (_, i) => person.trials[i] ?? emptyTrial()), emptyTrial()] })}>次の試技を追加</Button>}
        </section>}
      </div>}
      {!visible.length && <p className="p-6 text-center text-body">出場者はいません</p>}
      {message && <p role="alert" className="text-body text-danger">{message}</p>}
      {draft.message && <p role={draft.failed ? "alert" : "status"} className={`text-body ${draft.failed ? "text-danger" : "text-accent"}`}>{draft.message}</p>}
    </div>
    <FormModalFooter><div className="flex flex-wrap items-center justify-between gap-2"><label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" disabled={disabled} checked={data.confirmed} onChange={e => draft.change({ ...data, confirmed: e.target.checked })}/>結果を確認済みにする</label><Button disabled={draft.busy || draft.reviewing || !draft.dirty && !draft.unconfirmed} onClick={() => void draft.save()}>{draft.busy ? draft.unconfirmed ? "確認中…" : "保存中…" : draft.unconfirmed ? "保存結果を確認" : "保存する"}</Button></div></FormModalFooter>
  </FormModal>;
}
