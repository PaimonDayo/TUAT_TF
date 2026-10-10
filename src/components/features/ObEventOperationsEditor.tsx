"use client";

import { useEffect, useRef, useState } from "react";
import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MeetEvent, MeetMark, emptyTrial, type MeetEventData, type MeetPerformance, type MeetTrial } from "@/lib/meet-operations";
import { effectiveObParticipation, obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import { type ObEntry } from "@/lib/ob-entries";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import { fieldOrderRows } from "@/lib/meet-field-order";
import { obMixedFieldNumbers, obMixedGroup, obMixedGroupLabel, obMixedLimits, obSourceDivision, projectObMixedEvent, splitObMixedEvent, type ObMixedProjection } from "@/lib/ob-mixed-operations";
import { useObOperationDraft } from "./useObOperationDraft";
import { ObOperationConflict } from "./ObOperationConflict";
import { formatObRecordInput } from "@/lib/ob-record-input";
import { obResultRanks } from "@/lib/ob-result-ranking";

const statusLabels = { entered: "出場", DNS: "DNS（欠場）", DNF: "DNF（途中棄権）", DQ: "DQ（失格）" } as const;
export function ObEventOperationsEditor({ event, entries, initial, operations = [], onSaved, onClose, onAddEntry, initialEntryId }: { initialEntryId?: string; event: string; entries: ObEntry[]; initial?: ObEventOperation; operations?: ObEventOperation[]; onSaved: (saved: ObEventOperation) => void; onClose: () => void; onAddEntry?: (event: string) => void }) {
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
  const [editing, setEditing] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
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
  const visible = ordered.filter(p => (!initialEntryId || p.entryId === initialEntryId) && (rule.discipline !== "track" || group === "all" || String(obMixedGroup(event, p)) === group));
  const person = visible.find(p => p.entryId === personId) ?? visible[0];
  const stateOf = (p: MeetPerformance) => effectiveObParticipation(event, people.get(p.entryId), p);
  const editable = (p: MeetPerformance) => { const state = stateOf(p); return state.registered && !state.absent; };
  const ranks = obResultRanks(rule, data.participants.filter(p => stateOf(p).canParticipate));
  useEffect(() => {
    if (editing || !draft.dirty || disabled || draft.failed || draft.blocked.length || new MeetEvent(rule, { ...data, confirmed: false }, { maxOrder: 600 }).validate()) return;
    const timer = window.setTimeout(() => void draft.save(), 600);
    return () => window.clearTimeout(timer);
  }, [editing, draft, disabled, rule, data]);
  function nextInput(id: string) {
    const ids = visible.filter(p => editable(p) && p.status === "entered").map(p => p.entryId);
    const target = inputs.current.get(ids[ids.indexOf(id) + 1]);
    if (target) { target.focus(); target.select(); } else inputs.current.get(id)?.blur();
  }
  function pasteTimes(id: string, text: string): boolean {
    if (!/[\t\r\n]/.test(text)) return false;
    const cells = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map(line => line.split("\t"));
    const targets = visible.filter(p => editable(p) && p.status === "entered");
    const start = targets.findIndex(p => p.entryId === id);
    if (start < 0 || cells.length > targets.length - start || cells.some(row => row.length > (rule.wind ? 2 : 1))) {
      setMessage("表示中の出場者のタイム欄に収まる範囲を選んで貼り付けてください"); return true;
    }
    const patch = new Map(cells.map((row, index) => {
      const person = targets[start + index], text = formatObRecordInput(row[0], event.slice(2));
      return [person.entryId, { ...person, trials: [{ ...(person.trials[0] ?? emptyTrial()), mark: text, status: text ? "valid" as const : "pending" as const,
        wind: text ? (row[1]?.normalize("NFKC").trim() ?? person.trials[0]?.wind ?? "") : "" }] }];
    }));
    setMessage(""); draft.change({ ...data, confirmed: false, participants: data.participants.map(p => patch.get(p.entryId) ?? p) });
    return true;
  }
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
  function finishMark(p: MeetPerformance, index: number, text: string) {
    const formatted = formatObRecordInput(text, event.slice(2));
    if (formatted !== (p.trials[index]?.mark ?? "")) mark(p, index, formatted);
    if (formatted && MeetMark.parse(formatted, rule.discipline) === null) setMessage(rule.discipline === "track" ? "タイムを確認してください。例：1234 → 12.34、41234 → 4:12.34" : "記録を確認してください。例：536 → 5.36");
  }
  const statusControl = (p: MeetPerformance) => <label className="block text-body font-medium">出場状況<select aria-label={`${people.get(p.entryId)?.submitted_name ?? "出場者"}の出場状況`} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-separator bg-card px-2 text-body font-normal" disabled={disabled || !editable(p)} value={p.status} onChange={e => status(p, e.target.value as MeetPerformance["status"])}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
  const trialCount = rule.discipline === "distance" ? 6 : Math.max(3, person?.trials.length ?? 0);
  const currentNumbers = draft.latestData ? numbersFor(project(draft.latestData)) : null;
  const conflictPosition = (p: MeetPerformance, source: "own" | "current") => {
    if (rule.discipline === "track") return trackPlacement(p);
    const number = (source === "own" ? fieldNumbers : currentNumbers)?.get(p.entryId);
    return number === undefined ? "順番を確認できません" : number === null ? "順番未定" : `試技順 ${number}番`;
  };
  return <FormModal open autoFocus={false} title={`${event} · 記録`} onOpenChange={open => !open && onClose()}>
    <FormDraftGuard dirty={draft.dirty} busy={draft.locked} onSave={draft.save}/>
    <div className="space-y-4" onFocusCapture={e => { if (e.target instanceof HTMLInputElement) setEditing(true); }} onBlurCapture={e => { if (!(e.relatedTarget instanceof HTMLInputElement)) setEditing(false); }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body">出場者 {initialEntryId ? `${visible.length}人表示 / ${data.participants.length}人` : `${data.participants.length}人`}</p>{onAddEntry && <Button variant="outline" disabled={disabled} onClick={() => onAddEntry(event)}>出場者を追加</Button>}</div>
      <ObOperationConflict draft={draft} entries={entries} event={event} positionLabel={conflictPosition}/>
      {rule.discipline === "track" && groups.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="表示する組">{["all", ...groups.map(String)].map(value => <Button key={value} size="sm" className="shrink-0" variant={group === value ? "primary" : "outline"} aria-pressed={group === value} onClick={() => setGroup(value)}>{value === "all" ? "全員" : obMixedGroupLabel(Number(value))}</Button>)}</div>}
      {rule.discipline === "track" ? <>
        <p className="text-body">{["1500m", "3000m"].includes(event.slice(2)) ? "41234 と入力 → 4分12秒34" : "1234 と入力 → 12秒34"}。Enterで次の人へ。欄を離れると自動保存します。</p>
        <div className="divide-y divide-separator rounded-xl border border-separator">{visible.map(p => {
          const entry = people.get(p.entryId), state = stateOf(p), trial = p.trials[0] ?? emptyTrial();
          return <section key={p.entryId} aria-label={`${entry?.submitted_name ?? "登録解除済み"}の記録`} className="grid min-w-0 items-center gap-2 bg-card p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(100px,1fr)]">
            <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-headline">{entry?.submitted_name ?? "登録解除済み"}</h3><p className="text-caption">{division} · {trackPlacement(p)} · {entry?.grade}{state.absent || !state.registered ? ` · ${state.label}` : ""}</p></div><span className="shrink-0 text-caption tabular-nums">{ranks.has(p.entryId) ? `${ranks.get(p.entryId)}位` : ""}</span></div>
            <div className={`grid gap-2 ${rule.wind ? "grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "grid-cols-1"}`}><label className="text-body font-medium">タイム<Input className="mt-1 border-ink/30 bg-bg font-normal focus:ring-2 focus:ring-accent/20" ref={node => { if (node) inputs.current.set(p.entryId, node); else inputs.current.delete(p.entryId); }} aria-label={`${entry?.submitted_name ?? "出場者"}のタイム`} placeholder={["1500m", "3000m"].includes(event.slice(2)) ? "例：41234（4分12秒34）" : "例：1234（12秒34）"} inputMode="decimal" enterKeyHint="next" autoComplete="off" disabled={disabled || !editable(p) || p.status !== "entered"} value={trial.mark} onChange={e => mark(p, 0, e.target.value)} onBlur={e => finishMark(p, 0, e.target.value)} onPaste={e => { if (pasteTimes(p.entryId, e.clipboardData.getData("text/plain"))) e.preventDefault(); }} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); nextInput(p.entryId); } }}/></label>{rule.wind && <label className="text-body font-medium">風速（m/s）<Input className="mt-1 border-ink/30 bg-bg font-normal" aria-label={`${entry?.submitted_name ?? "出場者"}の風速`} placeholder="+1.2" inputMode="decimal" disabled={disabled || !editable(p) || p.status !== "entered" || trial.status !== "valid"} value={trial.wind} onChange={e => changeTrial(p, 0, { wind: e.target.value })}/></label>}</div>
            {statusControl(p)}
          </section>;
        })}</div>
      </> : <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(200px,1fr)_minmax(0,3fr)]">
        <div className="overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">試技順</h3><div className="max-h-52 overflow-y-auto md:max-h-[calc(100dvh-240px)]">{visible.map(p => <button key={p.entryId} className={`flex min-h-14 w-full items-center justify-between gap-2 border-b border-separator p-3 text-left last:border-0 ${p.entryId === person?.entryId ? "bg-accent/10" : "bg-card"}`} aria-pressed={p.entryId === person?.entryId} onClick={() => setPersonId(p.entryId)}><span className="min-w-0"><span className="block break-words text-body">{people.get(p.entryId)?.submitted_name ?? "登録解除済み"}</span><span className="block text-caption">{division} · {fieldPlacement(p)}{stateOf(p).absent || !stateOf(p).registered ? ` · ${stateOf(p).label}` : ""}</span></span><span className="shrink-0 text-caption tabular-nums">{model.best(p)}</span></button>)}</div></div>
        {person && <section aria-label="選択した出場者の試技" className="min-w-0 space-y-4">
          <div className="flex gap-2">{([-1, 1] as const).map(direction => { const next = visible[visible.findIndex(p => p.entryId === person.entryId) + direction]; return <Button key={direction} size="sm" variant="outline" disabled={!next} onClick={() => next && setPersonId(next.entryId)}>{direction < 0 ? "前の出場者" : "次の出場者"}</Button>; })}</div>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-title">{people.get(person.entryId)?.submitted_name ?? "登録解除済み"}</h3><p className="text-body">{division} · {fieldPlacement(person)} · ベスト {model.best(person)}{ranks.has(person.entryId) ? ` · ${ranks.get(person.entryId)}位` : ""}</p></div><div className="w-40">{statusControl(person)}</div></div>
          <p className="text-caption">{rule.discipline === "height" ? "高さをmで入力し、○・×・−を選びます。同じ高さも1試技ずつ記録してください。" : "記録をmで入力してください。失敗は×、パスは−を選びます。"}</p>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{Array.from({ length: trialCount }, (_, index) => {
            const trial = person.trials[index] ?? emptyTrial(), locked = disabled || !editable(person) || person.status !== "entered";
            return <fieldset key={`${person.entryId}:${index}`} disabled={locked} className="min-w-0 space-y-2 rounded-xl border border-separator bg-card p-3"><legend className="px-1 text-body font-semibold">{index + 1}回目</legend><label className="block text-body font-medium">{rule.discipline === "height" ? "高さ（m）" : "記録（m）"}<Input aria-label={`${index + 1}回目の記録`} inputMode="decimal" className="mt-1 border-ink/30 bg-bg font-normal focus:ring-2 focus:ring-accent/20" placeholder={rule.discipline === "height" ? "例：150 → 1.50 m" : "例：536 → 5.36 m"} value={trial.mark} onChange={e => mark(person, index, e.target.value)} onBlur={e => finishMark(person, index, e.target.value)}/></label><div className="flex gap-2" role="group" aria-label={`${index + 1}回目の結果`}>{([...(rule.discipline === "height" ? ["valid" as const] : []), "foul", "pass"] as const).map(outcome => <Button key={outcome} className="flex-1" size="sm" variant={trial.status === outcome ? "primary" : "outline"} aria-pressed={trial.status === outcome} aria-label={`${index + 1}回目を${outcome === "valid" ? "成功" : outcome === "foul" ? "失敗" : "パス"}`} onClick={() => changeTrial(person, index, { status: trial.status === outcome ? "pending" : outcome, wind: "", ...(rule.discipline !== "height" || trial.status === outcome ? { mark: "" } : {}) })}>{outcome === "valid" ? "○" : outcome === "foul" ? "×" : "−"}</Button>)}</div>{rule.wind && <label className="block text-caption">風速<Input aria-label={`${index + 1}回目の風速`} placeholder="+1.2" inputMode="decimal" value={trial.wind} disabled={trial.status !== "valid"} onChange={e => changeTrial(person, index, { wind: e.target.value })}/></label>}</fieldset>;
          })}</div>
          {rule.discipline === "height" && trialCount < 30 && <Button variant="outline" disabled={disabled || !editable(person) || person.status !== "entered"} onClick={() => update(person.entryId, { trials: [...Array.from({ length: trialCount }, (_, i) => person.trials[i] ?? emptyTrial()), emptyTrial()] })}>次の試技を追加</Button>}
        </section>}
      </div>}
      {!visible.length && <p className="p-6 text-center text-body">出場者はいません</p>}
      <p role="status" className="text-caption">{draft.busy ? "保存中…" : draft.unconfirmed ? "保存結果の確認が必要です" : draft.failed ? "未保存です。入力は残っています" : draft.dirty ? "未保存です。入力を終えると自動で保存します" : "保存済みです"}</p>
      {message && <p role="alert" className="text-body text-danger">{message}</p>}
      {draft.message && <p role={draft.failed ? "alert" : "status"} className={`text-body ${draft.failed ? "text-danger" : "text-accent"}`}>{draft.message}</p>}
    </div>
    {(draft.failed || draft.unconfirmed) && <FormModalFooter><Button disabled={draft.busy || draft.reviewing || !draft.dirty && !draft.unconfirmed} onClick={() => void draft.save()}>{draft.busy ? draft.unconfirmed ? "確認中…" : "保存中…" : draft.unconfirmed ? "保存結果を確認" : "保存を再試行"}</Button></FormModalFooter>}
  </FormModal>;
}
