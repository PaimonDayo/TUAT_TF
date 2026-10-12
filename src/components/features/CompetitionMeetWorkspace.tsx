"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { GRADE_OPTIONS } from "@/lib/constants";
import { MeetEvent } from "@/lib/meet-operations";
import { meetDutyText, meetDutyConflict, meetEventCounts, meetRule, type CompetitionMeet, type ManagedMeetEvent, type MeetAppearance, type MeetCommand, type MeetParticipant } from "@/lib/competition-meet";
import { mutateCompetitionMeet, checkCompetitionMeetMutation } from "@/app/(app)/competitions/meet-actions";
import { CompetitionMeetEventEditor } from "./CompetitionMeetEventEditor";
import { ObLiveRefresh } from "./ObLiveRefresh";
import {CompetitionMeetDutyEditor,CompetitionMeetRoleEditor} from "./CompetitionMeetDutyEditor";
import {CompetitionMeetStaffEditor} from "./CompetitionMeetStaffEditor";
import { CompetitionMeetDutyTable } from "./CompetitionMeetDutyTable";
import type { MeetDutySlot } from "@/lib/competition-meet-duties";
import {CompetitionMeetHistory} from "./CompetitionMeetHistory";
import {Disclosure} from "@/components/ui/disclosure";
import {entryGrade} from "@/lib/entry-identity";

export type MeetMutation = ReturnType<typeof useMeetMutation>;
type Mutation = MeetMutation;
function useMeetMutation(competitionId: string, backend: "pc" | "cloud") {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [notSaved,setNotSaved]=useState(false),[confirmedRequest,setConfirmedRequest]=useState("");
  const pending = useRef<{ id: string; command: MeetCommand } | null>(null), sending = useRef(false);
  const savedId=useRef<string|undefined>(undefined);
  const router = useRouter();
  async function run(command: MeetCommand) {
    if (sending.current || pending.current) return false;
    sending.current = true; setBusy(true); setMessage("");
    const attempt = { id: crypto.randomUUID(), command: structuredClone({...command,backend}) };
    try {
      const result = await mutateCompetitionMeet(competitionId, attempt.id, attempt.command);
      if (result.uncertain) { pending.current = attempt; setUncertain(true); }
      if (!result.ok) { setMessage(result.message ?? "保存できませんでした。入力は残っています"); if (result.stale) router.refresh(); return false; }
      savedId.current=result.id;setMessage("保存しました"); router.refresh(); return true;
    } catch { pending.current = attempt; setUncertain(true); setMessage("保存結果を確認できませんでした。入力は残っています"); return false; }
    finally { sending.current = false; setBusy(false); }
  }
  async function check() {
    if (sending.current || !pending.current) return;
    sending.current = true; setBusy(true);
    try {
      const value = pending.current, result = await checkCompetitionMeetMutation(competitionId, value.id, value.command);
      if (!result.ok) { setNotSaved(!!result.notSaved); setMessage(result.message ?? "保存結果を確認できませんでした"); return; }
      savedId.current=result.id;pending.current = null; setNotSaved(false); setUncertain(false); setConfirmedRequest(value.id); setMessage("保存を確認しました。最新の情報を読み込んでいます"); router.refresh();
    } catch { setMessage("保存結果を確認できませんでした。接続後にもう一度確認してください"); }
    finally { sending.current = false; setBusy(false); }
  }
  async function retry() {
    if(sending.current||!pending.current||!notSaved)return;
    sending.current=true;setBusy(true);setNotSaved(false);
    try{const attempt=pending.current,result=await mutateCompetitionMeet(competitionId,attempt.id,attempt.command);if(result.ok){savedId.current=result.id;pending.current=null;setUncertain(false);setConfirmedRequest(attempt.id);setMessage("保存しました");router.refresh();}else{setMessage(result.message??"保存結果を確認してください");if(!result.uncertain){pending.current=null;setUncertain(false);}}}catch{setMessage("保存結果を確認できませんでした。入力は残っています。結果を確認してください");}finally{sending.current=false;setBusy(false);}
  }
  return { run, check, retry, getSavedId:()=>savedId.current, notSaved, confirmedRequest, busy, message, uncertain, locked: busy || uncertain };
}

type Editor = { kind: "participant"; id?: string; self?:boolean } | { kind: "appearance"; participantId?: string; event?: string; id?: string; returnEvent?:string } | { kind: "event"; name: string; appearanceId?:string } | { kind: "configure" } | {kind:"role";id?:string;slot?:MeetDutySlot} | {kind:"newDuty";roleId?:string;slot?:MeetDutySlot;personId?:string} | {kind:"staff"} | { kind: "duty"; id: string } | { kind: "party"; id?: string; participantId?:string };
export function CompetitionMeetWorkspace({ meet, me, initialSection = "events", initialEdit = false }: { meet: CompetitionMeet; me: { id: string; display_name: string; grade: string | null }; initialSection?: "events" | "participants" | "duties"; initialEdit?: boolean }) {
  const [section, setSection] = useState(initialSection), [search, setSearch] = useState(""), [showDeleted, setShowDeleted] = useState(false);
  const mine = meet.participants.find(person => person.profile_id === me.id);
  const canRegister=meet.permissions.register??meet.permissions.record;
  const [detailId, setDetailId] = useState<string | null>(initialEdit ? mine?.id ?? null : null);
  const [editor, setEditor] = useState<Editor | null>(initialEdit && !mine&&meet.events.length&&(canRegister||meet.permissions.manage) ? { kind: "participant",self:true } : null);
  const [confirm, setConfirm] = useState<{ title: string; command: MeetCommand; description: string } | null>(null);
  const mutation = useMeetMutation(meet.competitionId,meet.backend);
  const [handledRequest,setHandledRequest]=useState("");
  if(mutation.confirmedRequest&&mutation.confirmedRequest!==handledRequest){setHandledRequest(mutation.confirmedRequest);setEditor(null);setConfirm(null);setDetailId(null);}
  const detail = meet.participants.find(person => person.id === detailId);
  const canEdit = (person: MeetParticipant) => meet.permissions.manage || canRegister && person.profile_id === me.id;
  const close = () => { if (!mutation.locked) setEditor(null); };
  const confirmLabel=mutation.notSaved?"同じ操作を再送":mutation.uncertain?"保存結果を確認":"実行する";
  async function confirmedOperation(command:MeetCommand){if(mutation.notSaved){await mutation.retry();return false;}if(mutation.uncertain){await mutation.check();return false;}return mutation.run(command);}
  function requestAppearance(appearance: MeetAppearance, action: "appearance.cancel" | "appearance.delete" | "appearance.restore") {
    const duties=action==="appearance.restore"?meet.duties.filter(d=>d.participant_id===appearance.participant_id&&d.slot_time===meet.events.find(e=>e.name===appearance.event_name)?.starts_at&&(d.assignment||d.role_ids.length)):[];
    setConfirm({ title: action === "appearance.restore" ? "この出場を復帰しますか？" : action === "appearance.cancel" ? "この出場を取り消しますか？" : "この出場を削除しますか？", command: { action, id: appearance.id, revision: appearance.revision,...(duties.length?{confirmDuties:true}:{}) }, description: action === "appearance.restore" ? `同じ出場の記録を保持し、未配置の出場予定に戻します。${duties.length?"補助担当と重なります。担当を保持し、補助担当の画面で交代を確認できます。":""}` : "この出場の配置を解除します。記録と履歴は保持し、あとから復帰できます。ほかの出場と補助担当は変更しません。" });
  }
  return <div className="space-y-4 px-4 pb-8 pt-2">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-headline">大会の運営</h2><Button variant="outline" disabled={mutation.locked||!meet.events.length||!mine&&!canRegister&&!meet.permissions.manage} onClick={() => mine ? setDetailId(mine.id) : setEditor({ kind: "participant",self:true })}>自分の登録</Button></div>
    {meet.permissions.configure&&<Button variant="ghost" disabled={mutation.locked} onClick={()=>setEditor({kind:"staff"})}>大会の担当ロール</Button>}
    <ObLiveRefresh />
    <SegmentedControl items={[{ key: "events", label: "競技" }, { key: "participants", label: "参加者" }, { key: "duties", label: "補助担当" }]} value={section} onChange={setSection} />
    {mutation.message && <p role={mutation.uncertain ? "alert" : "status"} className="text-body">{mutation.message}</p>}
    {mutation.uncertain && <Button disabled={mutation.busy} onClick={() => void mutation.check()}>保存結果を確認</Button>}{mutation.notSaved&&<Button disabled={mutation.busy} onClick={()=>void mutation.retry()}>同じ操作を再送</Button>}
    {section === "events" ? <>
      {(meet.program?.length??0)>0&&<Disclosure title="大会予定"><ul className="divide-y divide-separator">{meet.program!.map(slot=><li key={slot.time+slot.label} className="flex gap-3 py-2 text-body"><span className="w-12 shrink-0">{slot.time}</span><span>{slot.label}{slot.note?`（${slot.note}）`:""}</span></li>)}</ul></Disclosure>}
      <div className="flex flex-wrap gap-2">{(meet.permissions.manage || canRegister&&mine && !mine.deleted) && <Button disabled={mutation.locked} onClick={() => setEditor({ kind: "appearance" })}>出場を追加</Button>}{meet.permissions.configure && <Button variant="outline" onClick={() => setEditor({ kind: "configure" })}>種目を追加</Button>}</div>
      <div className="space-y-2">{meet.events.map(event => {
        const counts = meetEventCounts(meet, event);
        return <Card key={event.name}><button data-ui-row className="flex min-h-16 w-full items-center gap-3 p-3.5 text-left pressable" onClick={() => setEditor({ kind: "event", name: event.name })}>
          <span className="w-12 shrink-0 text-caption tabular-nums">{event.starts_at ?? "未定"}</span><span className="min-w-0 flex-1"><span className="block text-body font-semibold">{event.name}</span><span className="block text-caption">出場 {counts.people}人・{counts.appearances}件{counts.dns > 0 ? ` / DNS ${counts.dns}件` : ""}{counts.dnf > 0 ? ` / DNF ${counts.dnf}件` : ""}{counts.dq > 0 ? ` / DQ ${counts.dq}件` : ""}</span></span><span className="text-caption">{event.confirmed ? "確定" : "組・記録"} →</span>
        </button></Card>;
      })}</div>
      {!meet.events.length && <EmptyState title="種目はまだありません" description="大会の管理者が種目を追加すると、出場登録と記録入力を始められます。" />}
    </> : section === "participants" ? <>
      {meet.permissions.history&&<CompetitionMeetHistory competitionId={meet.competitionId}/>}
      {meet.permissions.manage && <Button disabled={mutation.locked} onClick={() => setEditor({ kind: "participant" })}>参加者を登録</Button>}
      <Input aria-label="参加者を検索" placeholder="氏名・学年で検索" value={search} onChange={event => setSearch(event.target.value)} />
      <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" checked={showDeleted} onChange={event => setShowDeleted(event.target.checked)} />削除した参加者も表示</label>
      <Card className="divide-y divide-separator">{meet.participants.filter(person => (showDeleted || !person.deleted) && `${person.name} ${person.grade}`.includes(search)).map(person => <button data-ui-row key={person.id} className="flex min-h-14 w-full items-center gap-3 p-3.5 text-left pressable" onClick={() => setDetailId(person.id)}><span className="min-w-0 flex-1"><span className="block text-body font-semibold">{person.name}</span><span className="block text-caption">{person.grade}{person.absent ? "・大会欠席" : ""}{person.deleted ? "・削除済み" : ""}</span></span><span className="text-caption">{meet.appearances.filter(a => a.participant_id === person.id && a.state === "registered").length}件の出場登録 →</span></button>)}</Card>
      <h3 className="text-headline">懇親会</h3>{meet.partyInfo&&<p className="text-caption">{meet.partyInfo.time} {meet.partyInfo.venue}・参加費 {meet.partyInfo.fee.toLocaleString()}円</p>}<Card className="divide-y divide-separator">{meet.party.map(party => <button data-ui-row key={party.id} className="flex min-h-12 w-full items-center justify-between gap-3 p-3.5 text-left" onClick={() => setEditor({ kind: "party", id: party.id })}><span>{party.group_label} {party.name}</span><span className="text-caption">{party.needs_review ? "確認待ち・" : ""}{party.status}</span></button>)}</Card>
    </> : <>
      {meet.permissions.manage&&<div className="flex flex-wrap gap-2"><Button disabled={mutation.locked} onClick={()=>setEditor({kind:"newDuty"})}>補助担当を追加</Button><Button variant="outline" disabled={mutation.locked} onClick={()=>setEditor({kind:"role"})}>役割を追加</Button></div>}
      <CompetitionMeetDutyTable meet={meet} locked={mutation.locked} onDuty={id=>setEditor({kind:"duty",id})} onAdd={(slot,personId,roleId)=>setEditor({kind:"newDuty",slot,personId,roleId})} onRole={(id,slot)=>setEditor({kind:"role",id,slot})} onDeleteRole={(id,revision)=>confirmedOperation({action:"role.delete",id,revision})} onEvent={(name,appearanceId)=>setEditor({kind:"event",name,appearanceId})} deleteStatus={mutation.message} deleteConfirmLabel={confirmLabel}/>

    </>}
    {detail && <FormModal open autoFocus={false} title={detail.name} onOpenChange={open => !open && !mutation.locked && setDetailId(null)}>
      <FormDraftGuard dirty={false} busy={mutation.locked} onSave={mutation.check} />
      <div className="space-y-4"><div className="flex items-center justify-between gap-3"><p className="text-body">{detail.grade}{detail.absent ? "・大会欠席" : ""}{detail.deleted ? "・削除済み" : ""}</p>{canEdit(detail) && <ActionMenu className="h-11 w-11" disabled={mutation.locked} deleteStatus={mutation.message} deleteConfirmLabel={mutation.notSaved?"同じ操作を再送":mutation.uncertain?"保存結果を確認":undefined} onEdit={meet.permissions.manage?() => { setDetailId(null); setEditor({ kind: "participant", id: detail.id }); }:undefined} onDelete={meet.permissions.manage && !detail.deleted ? () => confirmedOperation({ action: "participant.delete", id: detail.id, revision: detail.revision }).then(ok => { if(ok)setDetailId(null); return ok; }) : undefined} deleteTitle="この参加者を削除しますか？" deleteDescription="通常の参加者一覧から除き、配置を解除します。記録・出場ID・懇親会回答・履歴を保持し、あとから復帰できます。補助担当は保持し、削除中は担当人数に数えません。補助担当の画面で交代できます。" />}</div>
        {detail.deleted && meet.permissions.manage && <Button disabled={mutation.locked} onClick={() => setConfirm({ title: "この参加者を復帰しますか？", command: { action: "participant.restore", id: detail.id, revision: detail.revision }, description: "参加者一覧へ戻します。出場は未配置・取消中のまま保持します。出場ごとの復帰を確認してください。" })}>参加者を復帰</Button>}
        {canEdit(detail)&&!detail.deleted&&(meet.partyInfo||meet.party.some(p=>p.participant_id===detail.id))&&<Button variant="outline" disabled={mutation.locked} onClick={()=>{const reply=meet.party.find(p=>p.participant_id===detail.id);setDetailId(null);setEditor({kind:"party",id:reply?.id,participantId:detail.id});}}>懇親会の出欠</Button>}<h3 className="text-headline">出場</h3>
        {meet.appearances.filter(a => a.participant_id === detail.id).map(a => <Card key={a.id} className="space-y-2 p-3.5"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-body font-semibold">{a.event_name}・{a.ordinal}件目</p><p className="text-caption">{a.state === "cancelled" ? "取消済み" : a.state === "deleted" ? "削除済み" : a.performance.status === "entered" ? "出場予定" : a.performance.status}・資格記録 {a.qualification_mark ?? "未入力"}</p><p className="text-caption">保存記録 {a.performance.status==="DNF"||a.performance.status==="DQ"?`${a.performance.status}・`:""}{new MeetEvent(meetRule(meet.events.find(e => e.name === a.event_name)!),{ participants: [{...a.performance,status:"entered"}],confirmed:false }).best({...a.performance,status:"entered"})}</p></div>{canEdit(detail) && <ActionMenu className="h-11 w-11" disabled={mutation.locked} deleteStatus={mutation.message} deleteConfirmLabel={mutation.notSaved?"同じ操作を再送":mutation.uncertain?"保存結果を確認":undefined} onEdit={() => {setDetailId(null);setEditor({kind:"appearance",id:a.id});}} editLabel="出場を編集" onDelete={a.state !== "deleted" ? () => confirmedOperation({action:"appearance.delete",id:a.id,revision:a.revision}) : undefined} deleteTitle="この出場を削除しますか？" deleteDescription="この出場だけを削除扱いにします。配置は解除し、記録と履歴は保持します。ほかの出場は変更しません。" />}</div>
          {canEdit(detail) && !detail.absent && !detail.deleted && <Button size="sm" className="min-h-11" variant="outline" disabled={mutation.locked} onClick={() => requestAppearance(a,a.state === "registered" && a.performance.status !== "DNS" ? "appearance.cancel" : "appearance.restore")}>{a.state === "registered" && a.performance.status !== "DNS" ? "この出場を取り消す" : "この出場を復帰"}</Button>}
          <Button size="sm" className="min-h-11" variant="ghost" disabled={mutation.locked} onClick={()=>{setDetailId(null);setEditor({kind:"event",name:a.event_name,appearanceId:a.id});}}>記録・配置を確認</Button>
        </Card>)}
        {canEdit(detail) && !detail.deleted && !detail.absent && <Button disabled={mutation.locked} onClick={() => {setDetailId(null);setEditor({kind:"appearance",participantId:detail.id});}}>出場を追加</Button>}
        {meet.permissions.manage && !detail.deleted && <Button variant="outline" disabled={mutation.locked} onClick={() => setConfirm({title:detail.absent?"大会欠席を取り消しますか？":"大会全体を欠席にしますか？",command:{action:"participant.attendance",id:detail.id,revision:detail.revision,absent:!detail.absent},description:"出場IDと記録を保持し、配置を解除します。欠席を取り消したあとは出場ごとに復帰できます。"})}>{detail.absent ? "大会欠席を取り消す" : "大会全体を欠席"}</Button>}
        <MutationStatus mutation={mutation}/>
      </div>
    </FormModal>}
    {editor?.kind === "participant" && <ParticipantEditor key={editor.id ?? "new"} self={editor.self} person={meet.participants.find(p=>p.id===editor.id)} meet={meet} me={me} mutation={mutation} onClose={close} onSaved={()=>{setEditor(null);setDetailId(mutation.getSavedId()??null);}} />}
    {editor?.kind === "appearance" && <AppearanceEditor key={editor.id ?? `${editor.participantId}:${editor.event}`} appearance={meet.appearances.find(a=>a.id===editor.id)} participantId={editor.participantId} event={editor.event} meet={meet} me={me.id} mutation={mutation} onClose={close} onSaved={()=>editor.returnEvent?setEditor({kind:"event",name:editor.returnEvent,appearanceId:mutation.getSavedId()}):editor.participantId?(setEditor(null),setDetailId(editor.participantId)):close()} />}
    {editor?.kind === "event" && <CompetitionMeetEventEditor key={editor.name} initialAppearanceId={editor.appearanceId} event={meet.events.find(e=>e.name===editor.name)!} meet={meet} mutation={mutation} onClose={close} onAdd={() => setEditor({kind:"appearance",event:editor.name,returnEvent:editor.name})} />}
    {editor?.kind === "role"&&<CompetitionMeetRoleEditor key={editor.id??"new"} roleId={editor.id} initialSlot={editor.slot} meet={meet} mutation={mutation} onClose={close}/>}
    {editor?.kind === "staff"&&<CompetitionMeetStaffEditor meet={meet} mutation={mutation} onClose={close}/>}
    {editor?.kind === "newDuty"&&<CompetitionMeetDutyEditor key={editor.roleId??"new"} roleId={editor.roleId} initialSlot={editor.slot} initialPersonId={editor.personId} meet={meet} mutation={mutation} onClose={close}/>}
    {editor?.kind === "configure" && <EventConfigEditor meet={meet} mutation={mutation} onClose={close} />}
    {(editor?.kind === "duty" || editor?.kind === "party") && <AssignmentEditor key={`${editor.kind}:${editor.id}`} editor={editor} meet={meet} mutation={mutation} onClose={close} />}
    <ConfirmDialog open={!!confirm} onOpenChange={open => !open && !mutation.busy && setConfirm(null)} title={confirm?.title ?? "確認"} description={`${confirm?.description ?? ""}${mutation.message?`\n${mutation.message}`:""}`} confirmLabel={confirmLabel} busyLabel="保存中…" busy={mutation.busy} onConfirm={async () => {if(confirm && await confirmedOperation(confirm.command))setConfirm(null);}} />
  </div>;
}

function MutationStatus({mutation}:{mutation:Mutation}) { return <>{mutation.busy&&<p role="status" className="text-caption">保存中…</p>}{mutation.message && <p role="status" className="text-caption">{mutation.message}</p>}{mutation.uncertain && <Button disabled={mutation.busy} onClick={()=>void mutation.check()}>保存結果を確認</Button>}{mutation.notSaved&&<Button disabled={mutation.busy} onClick={()=>void mutation.retry()}>同じ操作を再送</Button>}</>; }
function ParticipantEditor({person,self=false,meet,me,mutation,onClose,onSaved}:{person?:MeetParticipant;self?:boolean;meet:CompetitionMeet;me:{id:string;display_name:string;grade:string|null};mutation:Mutation;onClose:()=>void;onSaved:()=>void}) {
  const [original]=useState(person);
  const [name,setName]=useState(person?.name ?? (!self&&meet.permissions.manage ? "" : me.display_name));
  const [grade,setGrade]=useState(person?.grade ?? (!self&&meet.permissions.manage ? "" : entryGrade(me.grade)));
  const [profileId,setProfileId]=useState(person?.profile_id ?? (!self&&meet.permissions.manage ? "" : me.id));
  const dirty=name!==(original?.name??"")||grade!==(original?.grade??"")||profileId!==(original?.profile_id??"");
  async function save(){if(await mutation.run({action:"participant.save",id:original?.id,revision:original?.revision,name,grade,profileId:profileId||null}))onSaved();}
  return <FormModal open autoFocus={false} title={person?"参加者の編集":"参加者の登録"} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/><fieldset disabled={mutation.locked} className="space-y-4"><label className="block space-y-2 text-body">氏名<Input value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><label className="block space-y-2 text-body">学年・所属<Select ariaLabel="学年・所属" value={grade} onValueChange={setGrade} options={[...GRADE_OPTIONS.map(g=>({value:g.short,label:g.short})),{value:"OB・OG",label:"OB・OG"}]}/></label>{meet.permissions.manage&&<label className="block space-y-2 text-body">本人のアカウント<Select ariaLabel="本人のアカウント" value={profileId} onValueChange={value=>{setProfileId(value);const member=meet.members.find(m=>m.id===value);if(!person&&member){setName(member.display_name);setGrade(entryGrade(member.grade));}}} options={[{value:"",label:"アカウントなし"},...meet.members.map(member=>({value:member.id,label:`${entryGrade(member.grade)} ${member.display_name}`,disabled:meet.participants.some(p=>p.profile_id===member.id&&p.id!==person?.id)}))]}/><span className="block text-caption">同じ氏名の別人も登録できます。本人のアカウントは確認してから選んでください。</span></label>}</fieldset><MutationStatus mutation={mutation}/><FormModalFooter><Button className="w-full" disabled={mutation.locked||!dirty||!name.trim()||!grade} onClick={()=>void save()}>保存する</Button></FormModalFooter></FormModal>;
}
function AppearanceEditor({appearance,participantId,event,meet,me,mutation,onClose,onSaved}:{appearance?:MeetAppearance;participantId?:string;event?:string;meet:CompetitionMeet;me:string;mutation:Mutation;onClose:()=>void;onSaved:()=>void}) {
  const [original]=useState(appearance);
  const [person,setPerson]=useState(appearance?.participant_id??participantId??meet.participants.find(p=>p.profile_id===me)?.id??"");
  const [confirmDuties,setConfirmDuties]=useState(false);
  const [eventName,setEvent]=useState(appearance?.event_name??event??""); const [mark,setMark]=useState(appearance?.qualification_mark??"");
  const conflicts=!appearance?meet.duties.filter(d=>d.participant_id===person&&d.slot_time===meet.events.find(e=>e.name===eventName)?.starts_at&&(d.assignment||d.role_ids.length)):[];
  async function save(confirmed=false){if(conflicts.length&&!confirmed){setConfirmDuties(true);return;}if(await mutation.run(original?{action:"appearance.edit",id:original.id,revision:original.revision,mark:mark||null}:{action:"appearance.add",participantId:person,event:eventName,mark:mark||null,confirmDuties:confirmed}))onSaved();}
  const dirty=!original ? !!person||!!eventName||!!mark : mark!==(original.qualification_mark??"");
  return <FormModal open autoFocus={false} title={appearance?"出場の編集":"出場を追加"} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/><fieldset disabled={mutation.locked} className="space-y-4"><label className="block space-y-2 text-body">参加者<Select ariaLabel="出場する参加者" disabled={!!appearance} value={person} onValueChange={setPerson} options={meet.participants.filter(p=>!p.deleted&&!p.absent&&(meet.permissions.manage||p.profile_id===me)).map(p=>({value:p.id,label:`${p.grade} ${p.name}`}))}/></label><label className="block space-y-2 text-body">種目<Select ariaLabel="出場種目" disabled={!!appearance} value={eventName} onValueChange={setEvent} options={meet.events.map(e=>({value:e.name,label:`${e.starts_at??""} ${e.name}`,disabled:e.confirmed&&!appearance}))}/></label><label className="block space-y-2 text-body">資格記録（任意）<Input maxLength={1000} value={mark} onChange={e=>setMark(e.target.value)}/></label><p className="text-caption">同じ種目への出場も1件ずつ追加できます。ほかの出場の資格記録や結果は変更しません。</p>{conflicts.length>0&&<p className="text-caption">補助担当：{conflicts.map(d=>`${d.slot_time} ${d.event_name} ${meetDutyText(d,meet.roles)}`).join("・")}。登録後に担当の調整が必要です。</p>}</fieldset><MutationStatus mutation={mutation}/><FormModalFooter><Button className="w-full" disabled={mutation.locked||!person||!eventName||!dirty} onClick={()=>void save()}>保存する</Button></FormModalFooter><ConfirmDialog open={confirmDuties} onOpenChange={setConfirmDuties} title="出場と補助担当が重なります" description={`補助担当を保持して出場を登録します。大会担当者が補助担当の画面で交代を確認できます。${mutation.message?`\n${mutation.message}`:""}`} confirmLabel={mutation.notSaved?"同じ操作を再送":mutation.uncertain?"保存結果を確認":"確認して登録する"} busyLabel="保存中…" busy={mutation.busy} onConfirm={()=>mutation.notSaved?void mutation.retry():mutation.uncertain?void mutation.check():void save(true)}/></FormModal>;
}
function EventConfigEditor({meet,mutation,onClose}:{meet:CompetitionMeet;mutation:Mutation;onClose:()=>void}) {
  const [family,setFamily]=useState(""),[division,setDivision]=useState("男子"),[time,setTime]=useState(""),[discipline,setDiscipline]=useState("track"),[capacity,setCapacity]=useState(""),[wind,setWind]=useState(false);
  async function save(){if(await mutation.run({action:"event.configure",config:{name:`${division}${family.trim()}`,family:family.trim(),division:division as ManagedMeetEvent["division"],starts_at:time||null,sort_order:meet.events.length,discipline:discipline as ManagedMeetEvent["discipline"],capacity:capacity?Number(capacity):null,wind}}))onClose();}
  return <FormModal open title="種目を追加" autoFocus={false} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={!!family||!!time||!!capacity} busy={mutation.locked} onSave={save}/><fieldset disabled={mutation.locked} className="space-y-4"><label className="block space-y-2 text-body">種目名<Input placeholder="例：100m" value={family} maxLength={80} onChange={e=>setFamily(e.target.value)}/></label><Select ariaLabel="種目の区分" value={division} onValueChange={setDivision} options={[{value:"男子",label:"男子"},{value:"女子",label:"女子"},{value:"混合",label:"混合"}]}/><Select ariaLabel="競技形式" value={discipline} onValueChange={setDiscipline} options={[{value:"track",label:"トラック"},{value:"distance",label:"距離のフィールド"},{value:"height",label:"高さのフィールド"}]}/><label className="block space-y-2 text-body">開始時刻<Input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><label className="block space-y-2 text-body">組のレーン数（任意）<Input type="number" min={1} max={99} value={capacity} onChange={e=>setCapacity(e.target.value)}/></label><label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" checked={wind} onChange={e=>setWind(e.target.checked)}/>風速を記録</label></fieldset><MutationStatus mutation={mutation}/><FormModalFooter><Button className="w-full" disabled={mutation.locked||!family.trim()} onClick={()=>void save()}>保存する</Button></FormModalFooter></FormModal>;
}
function AssignmentEditor({editor,meet,mutation,onClose}:{editor:{kind:"duty";id:string}|{kind:"party";id?:string;participantId?:string};meet:CompetitionMeet;mutation:Mutation;onClose:()=>void}) {
  const [duty]=useState(meet.duties.find(d=>d.id===editor.id)),[party]=useState(meet.party.find(p=>p.id===editor.id));
  const [person,setPerson]=useState(duty?.participant_id??party?.participant_id??(editor.kind==="party"?editor.participantId:undefined)??""),[assignment,setAssignment]=useState(duty?.assignment??""),[roleIds,setRoles]=useState(duty?.role_ids??[]),[status,setStatus]=useState(party?.status??"未回答");
  const dirty=duty?person!==duty.participant_id||assignment!==duty.assignment||JSON.stringify(roleIds)!==JSON.stringify(duty.role_ids):status!==party?.status||person!==(party?.participant_id??"");
  async function save(){if(await mutation.run(duty?{action:"duty.save",id:duty.id,revision:duty.revision,participantId:person,assignment,roleIds}:{action:"party.save",id:party?.id,revision:party?.revision,status,...(person?{participantId:person}:{})}))onClose();}
  return <FormModal open title={duty?`${duty.slot_time} ${duty.event_name}の補助担当`:`${party?.name??meet.participants.find(p=>p.id===person)?.name??"参加者"}の懇親会`} autoFocus={false} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/><fieldset disabled={mutation.locked} className="space-y-4">{duty?<><Select ariaLabel="補助担当者" value={person} onValueChange={setPerson} options={meet.participants.filter(p=>p.id===duty.participant_id||!p.absent&&!p.deleted&&p.grade!=="OB・OG").map(p=>({value:p.id,label:`${p.grade} ${p.name}${p.absent||p.deleted?"（欠席・削除中）":meetDutyConflict(meet,p.id,duty.slot_time)?"（出場と重複）":""}`,disabled:p.id!==duty.participant_id&&(p.absent||p.deleted||meetDutyConflict(meet,p.id,duty.slot_time)||meet.duties.some(d=>d.id!==duty.id&&d.participant_id===p.id&&d.slot_time===duty.slot_time&&(d.assignment||d.role_ids.length)))}))}/>{meet.roles.filter(r=>r.slot_time===duty.slot_time&&r.event_name===duty.event_name).map(role=><label key={role.id} className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" checked={roleIds.includes(role.id)} onChange={e=>setRoles(e.target.checked?[...roleIds,role.id]:roleIds.filter(id=>id!==role.id))}/>{role.name}</label>)}<label className="block space-y-2 text-body">担当内容<Input value={assignment} onChange={e=>setAssignment(e.target.value)}/></label><Button variant="outline" onClick={()=>{setRoles([]);setAssignment("");}}>担当を解除</Button></>:<>{meet.permissions.manage&&party&&(!party.participant_id||party.needs_review)&&<Select ariaLabel="懇親会回答の参加者" value={person} onValueChange={setPerson} options={meet.participants.filter(p=>!p.deleted).map(p=>({value:p.id,label:`${p.grade} ${p.name}`,disabled:meet.party.some(r=>r.id!==party.id&&r.participant_id===p.id)}))}/>}<Select ariaLabel="懇親会の出欠" value={status} onValueChange={value=>setStatus(value as typeof status)} options={[{value:"参加",label:"参加"},{value:"不参加",label:"不参加"},{value:"未回答",label:"未回答"}]}/></>}</fieldset><MutationStatus mutation={mutation}/><FormModalFooter><Button className="w-full" disabled={mutation.locked||!dirty} onClick={()=>void save()}>保存する</Button></FormModalFooter></FormModal>;
}
