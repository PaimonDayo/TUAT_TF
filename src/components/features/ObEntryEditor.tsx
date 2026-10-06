"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { GRADE_OPTIONS } from "@/lib/constants";
import { SegmentedControl } from "@/components/ui/segmented";
import { checkEntryDetails, createGuestEntry, saveEntry } from "@/app/(app)/ob-entries/actions";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { OB_ENTRY_EVENTS, entryDivision, type EntryEdit } from "@/lib/ob-entry-edit";
import { entryGrade, normalizeEntryName, type EntryMember } from "@/lib/entry-identity";
import { OB_PARTY, OB_PROGRAM, PARTY_STATUSES, compareByGrade, obEventTime, type ObPartyResponse, type PartyEdit, type PartyStatus } from "@/lib/ob-meet";
import { type ObEntry } from "@/lib/ob-entries";
import { dutyRoleText, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { entryDutyConflicts } from "@/lib/ob-duty-issues";

export function ObEntryEditor({ entry, members, initialProfileId = "", party, parties = [], onClose, self = false, duties = [], roles = [] }: { duties?: ObDuty[]; roles?: ObDutyRole[]; self?: boolean; entry?: ObEntry; party?: ObPartyResponse; parties?: ObPartyResponse[]; members: EntryMember[]; initialProfileId?: string;
  onClose: () => void }) {
  function findParty(id: string) {return party ?? parties.find((p)=>!p.entry_id&&!p.needs_review&&normalizeEntryName(p.submitted_name)===normalizeEntryName(members.find((m)=>m.id===id)?.display_name??""));}
  const [selectedParty,setSelectedParty]=useState(()=>findParty(initialProfileId));
  const [partyStatus, setPartyStatus] = useState<PartyStatus>(selectedParty?.status ?? "未回答");
  const [mode, setMode] = useState("member");
  const [guestName, setGuestName] = useState("");
  const [guestGrade, setGuestGrade] = useState("");
  const [name, setName] = useState(entry?.submitted_name ?? "");
  const [grade, setGrade] = useState(entry?.grade ?? "");
  const [profileId, setProfileId] = useState(initialProfileId);
  const [events, setEvents] = useState(entry?.events ?? []);
  const [marks, setMarks] = useState(entry?.qualification_marks ?? {});
  const fixedDivision = entry ? entryDivision(entry) : null;
  const [gender, setGender] = useState<string>(fixedDivision ?? "");
  const [pendingDivision, setPendingDivision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const sending = useRef(false);
  const pending = useRef<{ input: EntryEdit; party: PartyEdit; confirmDuties: boolean } | null>(null);
  const [confirm, setConfirm] = useState<"save" | "close" | "division" | "duties" | null>(null);
  const [serverConflicts,setServerConflicts]=useState<{time:string;event:string;assignment:string}[]>([]);
  const router = useRouter();
  const { showToast } = useToast();
  const cleanMarks = Object.fromEntries(Object.entries(marks).filter(([event]) => events.includes(event)));
  const editingDetails = !!entry && !self;
  const detailsChanged = editingDetails && (name.trim() !== entry.submitted_name.trim() || grade !== entry.grade);
  const detailsValid = !detailsChanged || !!name.trim() && name.trim().length <= 100 && !!grade;
  const eventsChanged = JSON.stringify(events) !== JSON.stringify(entry?.events ?? []);
  const dirty = partyStatus !== (party?.status ?? "未回答") || eventsChanged || JSON.stringify(cleanMarks) !== JSON.stringify(entry?.qualification_marks ?? {}) || detailsChanged || (!entry && (!!profileId || !!guestName || !!guestGrade));
  const locked = saving || unconfirmed;
  const gradeOptions: { value: string; label: string; disabled?: boolean }[] = [...GRADE_OPTIONS.map(g => ({ value: g.short, label: g.short })), { value: "OB・OG", label: "OB・OG" }];
  if (entry?.grade && !gradeOptions.some(option => option.value === entry.grade)) gradeOptions.unshift({ value: entry.grade, label: entry.grade, disabled: true });
  const removed = entry?.events.filter((event) => !events.includes(event)) ?? [];
  const conflicts=(eventsChanged ? entryDutyConflicts(entry?.profile_id??entry?.id??profileId,events,duties) : []).map(duty=>({time:duty.slot_time,event:duty.event_name,assignment:dutyRoleText(duty,roles)}));
  const displayedConflicts=serverConflicts.length?serverConflicts:conflicts;
  async function save(confirmDuties = false) {
    if (sending.current || !pending.current && (!dirty || !detailsValid)) return;
    sending.current = true; setSaving(true); setSaveMessage("");
    const attempt = pending.current ?? {
      input: { entryId: entry?.id ?? null, profileId: entry ? null : profileId, revision: entry?.revision ?? null, events, marks: cleanMarks, ...(detailsChanged ? { details: { name: name.trim(), grade } } : {}) },
      party: { id: selectedParty?.id ?? null, revision: selectedParty?.revision ?? null, status: partyStatus }, confirmDuties,
    };
    try {
      const checking = !!pending.current;
      const result: {ok:boolean;message?:string;uncertain?:boolean;dutyConflicts?:{time:string;event:string;assignment:string}[]} = checking ? await checkEntryDetails(attempt.input, attempt.party) : !entry && !self && mode === "guest" ? await createGuestEntry({name:guestName,grade:guestGrade,events,marks:cleanMarks,partyStatus,partyId:selectedParty?.id??null,partyRevision:selectedParty?.revision??null}) : await saveEntry(attempt.input, attempt.party, attempt.confirmDuties);
      if (!result.ok && (checking || attempt.input.details && result.uncertain)) {
        pending.current = structuredClone(attempt); setUnconfirmed(true); setConfirm(null);
        setSaveMessage(result.message ?? "保存結果を確認できませんでした。入力は残っています。もう一度結果を確認してください"); return;
      }
      if (!result.ok) { if ("dutyConflicts" in result && result.dutyConflicts?.length) {setServerConflicts(result.dutyConflicts);setConfirm("duties");} else {showToast(result.message ?? "保存できませんでした");setConfirm(null);} return; }
      pending.current = null; setUnconfirmed(false);
      showToast("dutyConflicts" in result && result.dutyConflicts?.length ? "登録を保存しました。補助員の「！」から重複する担当を確認してください" : "回答を保存しました", "success");
      router.refresh(); onClose();
    } catch {
      if (attempt.input.details) {
        pending.current = structuredClone(attempt); setUnconfirmed(true); setSaveMessage("保存結果を確認できませんでした。入力は残っています。接続後に結果を確認してください");
      } else showToast("保存できませんでした");
      setConfirm(null);
    }
    finally { sending.current = false; setSaving(false); }
  }
  return <FormModal open autoFocus={false} title={entry ? "エントリーの編集" : "新規エントリー"}
    onOpenChange={(open) => { if (!open && !locked && !confirm) { if (dirty) setConfirm("close"); else onClose(); } }}>
    <section className="space-y-3" aria-label="エントリー編集">
    {editingDetails ? <div className="space-y-3">
      <label className="block space-y-2 text-body"><span>氏名</span><Input aria-label="参加者の氏名" maxLength={100} value={name} disabled={locked} onChange={e => setName(e.target.value)}/></label>
      <label className="block space-y-2 text-body"><span>学年・所属</span><Select ariaLabel="参加者の学年・所属" value={grade} disabled={locked} onValueChange={setGrade} options={gradeOptions}/></label>
    </div> : entry && <p className="text-headline">{entry.grade} {entry.submitted_name}</p>}
    {displayedConflicts.length>0&&<section aria-label="エントリー変更による補助担当の重複" className="rounded-xl border border-danger/30 bg-danger/5 p-3"><h3 className="text-headline text-danger">！出場と補助担当が重複します</h3><ul className="mt-2 space-y-1 text-body">{displayedConflicts.map((duty,index)=><li key={index}>{duty.time} {duty.event}：{duty.assignment}</li>)}</ul><p className="mt-2 text-caption">補助担当は保持します。保存後に担当者が補助員の「！」から代替者を選んでください。</p></section>}
    <ObProgramDisclosure />
    {!entry && self && <p className="text-headline">{members[0] ? `${entryGrade(members[0].grade)} ${members[0].display_name}` : ""}</p>}
    {!entry && !self && <SegmentedControl value={mode} onChange={value => {if(locked)return;setMode(value);const answer=value==="member"?findParty(profileId):parties.find(p=>!p.entry_id&&!p.needs_review&&normalizeEntryName(p.submitted_name)===normalizeEntryName(guestName));setSelectedParty(answer);setPartyStatus(answer?.status??"未回答");}} items={[{key:"member",label:"部員を選ぶ"},{key:"guest",label:"名前を入力"}]} />}
    {!entry && !self && mode === "guest" && <div className="space-y-3"><Input aria-label="参加者の氏名" placeholder="氏名を入力" maxLength={100} value={guestName} disabled={locked} onChange={e=>{setGuestName(e.target.value);const answer=parties.find(p=>!p.entry_id&&!p.needs_review&&normalizeEntryName(p.submitted_name)===normalizeEntryName(e.target.value));setSelectedParty(answer);setPartyStatus(answer?.status??"未回答");}} /><Select ariaLabel="参加者の学年・所属" value={guestGrade} disabled={locked} onValueChange={setGuestGrade} options={[{value:"",label:"学年・所属を選択"},...GRADE_OPTIONS.map(g=>({value:g.short,label:g.short})),{value:"OB・OG",label:"OB・OG"}]} /><p className="text-caption">アプリのアカウントを作らずに登録できます。</p></div>}
    {!entry && !self && mode === "member" && <Select value={profileId} onValueChange={(value)=>{
      setProfileId(value);
      const answer=findParty(value);
      setSelectedParty(answer);
      setPartyStatus(answer?.status??"未回答");
    }} disabled={locked} ariaLabel="追加する部員"
      options={[{ value: "", label: "部員を選択" }, ...[...members].sort((a, b) => compareByGrade({ grade: a.grade, name: a.display_name }, { grade: b.grade, name: b.display_name })).map((m) => ({ value: m.id, label: `${entryGrade(m.grade)} ${m.display_name}` }))]} />}
    <Card className="space-y-2 p-3.5"><h3 className="text-headline">懇親会の出欠</h3>
      <p className="text-caption">{OB_PARTY.time} {OB_PARTY.venue}<br />参加費 {OB_PARTY.fee.toLocaleString()}円</p>
      {selectedParty && !entry && <p className="text-caption">懇親会の既存回答：{selectedParty.group_label} {selectedParty.submitted_name}。同じ本人であることを確認して保存してください。</p>}
      <Select value={partyStatus} onValueChange={(value) => setPartyStatus(value as PartyStatus)} disabled={locked} ariaLabel="懇親会の出欠" options={PARTY_STATUSES.map((value) => ({value,label:value}))} />
    </Card>
    {!entry && <p className="text-caption">競技に出場する場合は区分と種目を選択してください。懇親会の回答だけでも登録できます。</p>}
    {fixedDivision ? <p className="text-caption">出場区分：{fixedDivision}（登録済みの種目から引き継ぎ）</p> : <div className="space-y-2">
      <p className="text-headline">出場区分</p>
      <Select value={gender} disabled={locked} ariaLabel="出場区分" options={[{value:"",label:"男子・女子を選択"},{value:"男子",label:"男子"},{value:"女子",label:"女子"}]}
        onValueChange={(value) => { if (events.length && value !== gender) { setPendingDivision(value); setConfirm("division"); } else setGender(value); }} />
      <p className="text-caption">本人の出場区分を確認してください。保存後は固定されます。</p>
    </div>}
    {gender && <>
      <div><h3 className="text-headline">出場種目・資格記録</h3><p className="mt-1 text-caption">出場する種目にチェックし、その下に資格記録を入力してください。</p></div>
      <Card data-ui-checklist className="divide-y divide-separator">
        {OB_ENTRY_EVENTS.filter((event) => event.startsWith(gender)).map((event) => {
          const selected = events.includes(event);
          return <div key={event} className="px-3.5">
            <label data-ui-checklist-row className="flex min-h-12 cursor-pointer items-center gap-3 py-3 text-body">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={selected} disabled={locked} aria-label={event}
                onChange={() => { setServerConflicts([]); setEvents(selected ? events.filter((e) => e !== event) : [...events, event]); if (!selected && !Object.hasOwn(marks, event)) setMarks({ ...marks, [event]: null }); }} />
              <span className="min-w-0 flex-1">{event.slice(2)}</span>
              {obEventTime(event) && <span className="shrink-0 text-caption tabular-nums">{obEventTime(event)}〜</span>}
            </label>
            {selected && <div className="pb-3 pl-8">
              <label htmlFor={`mark-${event}`} className="mb-1 block text-caption">資格記録（任意）</label>
              <Textarea id={`mark-${event}`} autoGrow rows={1} placeholder="未入力" maxLength={1000} disabled={locked} aria-label={`${event}の資格記録`} value={marks[event] ?? ""}
                onChange={(e) => setMarks({ ...marks, [event]: e.target.value || null })} />
            </div>}
          </div>;
        })}
      </Card>
      {entry && entry.events.length > 0 && !events.length && <p className="text-caption">保存すると全種目のエントリーを取り消します。</p>}
    </>}
    <FormModalFooter><div className="flex items-center gap-3">
      <span className="shrink-0 text-body">{events.length}種目</span>
      <Button className="flex-1" disabled={saving || !unconfirmed && (!dirty || !detailsValid || (!entry && ((mode === "guest" && !self ? !guestName.trim() || !guestGrade : !profileId) || (!events.length && partyStatus === "未回答"))))} onClick={() => unconfirmed ? void save() : conflicts.length ? setConfirm("duties") : removed.length ? setConfirm("save") : void save()}>{saving ? unconfirmed ? "確認中…" : "保存中…" : unconfirmed ? "保存結果を確認" : entry ? "変更を保存する" : "登録する"}</Button>
    </div>{saveMessage && <p role="alert" className="mt-3 text-body text-danger">{saveMessage}</p>}</FormModalFooter>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !saving) setConfirm(null); }}
      title={confirm === "duties" ? "補助担当の調整が必要です" : confirm === "division" ? "出場区分を変更しますか？" : confirm === "close" ? "変更を破棄しますか？" : "エントリーを取り消しますか？"}
      description={confirm === "duties" ? `${displayedConflicts.map(duty=>`${duty.time} ${duty.event}：${duty.assignment}`).join("。 ")}。補助担当を残して出場登録を保存します。担当者は代替者を選んでください。${removed.length?`${removed.join("・")}の出場登録は取り消します。`:""}` : confirm === "division" ? "選択した種目と入力中の資格記録をクリアします。" : confirm === "close" ? "保存していない変更は失われます。" : `${removed.join("・")}を取り消して保存します。`}
      confirmLabel={confirm === "duties" ? "確認して保存する" : confirm === "division" ? "変更する" : confirm === "close" ? "破棄する" : "取り消して保存する"} busyLabel="保存中…" busy={saving}
      onConfirm={() => { if (confirm === "division") { setGender(pendingDivision ?? ""); setEvents([]); setMarks({}); setConfirm(null); } else if (confirm === "close") onClose(); else void save(confirm === "duties"); }} />
  </section></FormModal>;
}

/** エントリー中もプログラム（時刻と種目）を確認できるように、編集画面の先頭に置く。 */
export function ObProgramDisclosure({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <Disclosure title="プログラム（タイムテーブル）" defaultOpen={defaultOpen}>
    <ul className="divide-y divide-separator text-body">
      {OB_PROGRAM.map((slot) => <li key={slot.time + slot.label} className="flex gap-3 py-2">
        <span className="w-12 shrink-0 tabular-nums text-muted2">{slot.time}</span>
        <span className={slot.events.length || slot.note ? "font-medium" : "text-muted2"}>{slot.label}{slot.note ? `（${slot.note}）` : ""}</span>
      </li>)}
    </ul>
  </Disclosure>;
}
