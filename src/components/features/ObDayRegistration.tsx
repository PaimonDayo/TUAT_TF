"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GRADE_OPTIONS } from "@/lib/constants";
import { entryDivision, OB_ENTRY_EVENTS } from "@/lib/ob-entry-edit";
import { normalizeEntryName } from "@/lib/entry-identity";
import type { ObEntry } from "@/lib/ob-entries";
import { hasRecordedObPerformance, obEventRule, obHeatCapacity, type ObEventOperation } from "@/lib/ob-operations";
import { addObDayEntry } from "@/app/(app)/ob-entries/operations-actions";

export function ObDayRegistration({ event: initialEvent, entries, operations, onClose, onSaved }: {
  event?: string; entries: ObEntry[]; operations: ObEventOperation[]; onClose: () => void; onSaved: (entryId: string, saved?: ObEventOperation) => void;
}) {
  const [event, setEvent] = useState(initialEvent ?? "");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [guest, setGuest] = useState(false);
  const [grade, setGrade] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [retry, setRetry] = useState(false);
  const sending = useRef(false), request = useRef<string | null>(null);
  const pending = useRef<Parameters<typeof addObDayEntry>[0] | null>(null);
  const router = useRouter();
  const chosen = entries.find(entry => entry.id === selected);
  const normalized = normalizeEntryName(search).toLowerCase();
  const candidates = entries.filter(entry => normalizeEntryName(entry.submitted_name + entry.grade).toLowerCase().includes(normalized));
  const operation = operations.find(value => value.event_name === event);
  const fixedLanes = obHeatCapacity(event) !== undefined;
  const field = !!event && obEventRule(event).discipline !== "track";
  const unplaced = fixedLanes || field;
  const division = event.startsWith("女子") ? "女子" : "男子";
  const family = event.replace(/^(男子|女子)/, "");
  const shared = operations.filter(value => value.event_name.replace(/^(男子|女子)/, "") === family)
    .flatMap(value => value.data.participants.map(person => ({ person, scope: person.heatScope ?? value.event_name.slice(0, 2) })));
  const groups = [...new Set(shared.flatMap(({person,scope}) => scope === division && person.group ? [person.group] : []))].sort((a, b) => a - b);
  const nextGroup = Math.max(0, ...groups) + 1;
  const closedGroup = (value: number) => !!operation?.data.confirmed || shared.some(({person,scope}) => scope === division && person.group === value && hasRecordedObPerformance(person));
  const wrongDivision = (entry: ObEntry, nextEvent = event) => !!nextEvent && !!entryDivision(entry) && !nextEvent.startsWith(entryDivision(entry)!);
  const ready = retry || !!event && (guest ? !!search.trim() && !!grade : !!chosen && !chosen.absent && !chosen.events.includes(event) && !wrongDivision(chosen));
  function changed() { request.current = null; pending.current = null; setRetry(false); setMessage(""); }
  async function save() {
    if (sending.current || !ready) return;
    sending.current = true; setBusy(true); setMessage("");
    request.current ??= crypto.randomUUID();
    try {
      pending.current ??= {operationId:request.current, event, ...(guest ? {name:search.trim(), grade} : {entryId:chosen!.id, revision:chosen!.revision}), group:unplaced ? null : group ? Number(group) : null};
      setRetry(true);
      const result = await addObDayEntry(pending.current);
      if (!result.ok || !result.entryId) {
        if (result.stale) { changed(); router.refresh(); }
        setMessage(result.message ?? "追加できませんでした。入力は残っています");
        return;
      }
      router.refresh(); onSaved(result.entryId, result.saved); onClose();
    } catch { setMessage("通信できませんでした。入力は残っています。同じ内容で再度保存できます"); }
    finally { sending.current = false; setBusy(false); }
  }
  return <FormModal open title="当日エントリー" autoFocus={false} onOpenChange={open => !open && onClose()}>
    <FormDraftGuard dirty={!!search || !!selected || !!grade || !unplaced && !!group} busy={busy} onSave={save}/>
    <fieldset disabled={busy} className="space-y-5">
      <label className="block space-y-2 text-body"><span>種目</span><Select ariaLabel="追加する種目" value={event} onValueChange={value => {setEvent(value); setGroup(""); if (chosen && (wrongDivision(chosen, value) || chosen.events.includes(value))) setSelected(null); changed();}} options={OB_ENTRY_EVENTS.map(value => ({value,label:value}))}/></label>
      <label className="block space-y-2 text-body"><span>{guest ? "氏名" : "参加者を探す"}</span><Input aria-label={guest ? "新しい参加者の氏名" : "当日エントリーの氏名検索"} value={search} maxLength={100} placeholder="氏名を入力" onChange={e => {setSearch(e.target.value); setSelected(null); changed();}}/></label>
      {guest ? <><label className="block space-y-2 text-body"><span>学年・区分</span><Select ariaLabel="当日参加者の学年・区分" value={grade} onValueChange={value => {setGrade(value); changed();}} options={[...GRADE_OPTIONS.map(value => ({value:value.short,label:value.short})),{value:"OB・OG",label:"OB・OG"}]}/></label><Button variant="ghost" onClick={() => {setGuest(false); changed();}}>登録済みの参加者から選ぶ</Button></> : <>
        <div className="max-h-64 overflow-hidden overflow-y-auto rounded-xl border border-separator divide-y divide-separator" aria-label="当日追加する参加者の候補">
          {candidates.map(entry => { const registered = !!event && entry.events.includes(event), mismatch = wrongDivision(entry); const unavailable=entry.absent || registered || mismatch; return <button key={entry.id} type="button" disabled={unavailable} aria-pressed={selected===entry.id} onClick={() => {setSelected(entry.id); changed();}} className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left ${selected===entry.id ? "bg-accent/10" : "bg-card"} disabled:text-muted2`}><span className="min-w-0 flex-1 break-words">{entry.submitted_name}<span className="ml-2 text-caption">{entryDivision(entry)}</span><span className="ml-2 text-caption">{entry.grade}</span></span><span className="shrink-0 text-caption">{entry.absent ? "大会欠席" : mismatch ? `${entryDivision(entry)}登録` : registered ? "登録済み" : selected===entry.id ? "選択中" : "選ぶ"}</span></button>;})}
          {!candidates.length&&<p className="p-4 text-caption">一致する参加者はいません</p>}
        </div>
        <Button variant="outline" className="w-full" onClick={() => {setGuest(true); setSelected(null); changed();}}>名簿にいない人を追加</Button>
      </>}
      {event && (field ? <p className="text-caption">追加した人は順番未定で表示されます。試技順で並べ替えてください。</p> : fixedLanes ? <p className="text-caption">追加した人は組未定に入ります。組分けで選んで組へ移してください。</p> : <label className="block space-y-2 text-body"><span>入れる組</span><Select ariaLabel="当日エントリーの組" value={group} onValueChange={value => {setGroup(value); changed();}} options={[{value:"",label:"未定に入れる"},...groups.map(value=>({value:String(value),label:`${division}${value}組${closedGroup(value)?"（記録入力済み）":""}`,disabled:closedGroup(value)})),...(nextGroup <= 99 ? [{value:String(nextGroup),label:"新しい組を作る",disabled:!!operation?.data.confirmed}] : [])]}/></label>)}
      {message&&<p role="alert" className="text-body text-danger">{message}</p>}
    </fieldset>
    <FormModalFooter><Button className="w-full" disabled={busy||!ready} onClick={()=>void save()}>{busy?"追加中…":field?"登録する":!unplaced&&group?"登録して組に入れる":"登録して未定に入れる"}</Button></FormModalFooter>
  </FormModal>;
}
