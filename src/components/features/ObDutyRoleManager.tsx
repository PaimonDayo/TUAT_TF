"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {FormModal,FormModalFooter} from "@/components/ui/form-modal";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ConfirmDialog} from "@/components/ui/confirm-dialog";
import {ActionMenu} from "@/components/ui/action-menu";
import {useToast} from "@/components/ui/toast";
import {deleteDutyRole,saveDutyRole,saveDutyPeople} from "@/app/(app)/ob-entries/actions";
import {adjacentCommitments,concurrentDuties,dutyRoleText,type ObDuty,type ObDutyRole,type DutyRoleEdit,type DutyCommitment} from "@/lib/ob-duty";
import {OB_DUTY_SLOTS,compareByGrade,dutyRows} from "@/lib/ob-meet";
import type {ObEntry} from "@/lib/ob-entries";
import {ObMeetRoster,obDutyCompetitionEvents,type ObEventOperation} from "@/lib/ob-operations";
import {obDutyIssues} from "@/lib/ob-duty-issues";
import { useObDutyReview } from "./ObDutyReviewProvider";
import { ObDutyIssues } from "./ObDutyIssues";
import {entryGrade,type EntryMember} from "@/lib/entry-identity";

/**
 * 種目の補助員一覧。役職ごとに「人を編集」で担当者を選ぶ（2026-09-26 オーナー指示）。
 * 候補は同時刻の出場・別種目担当がない部員。前後の競技・補助員と時刻を添える。
 * 役職名・必要人数の変更と未割当の役職削除は「…」から。
 */
export function ObDutyRoleManager({entries,time,event,roles,allRoles=roles,duties,members,operations=[],onClose}:{entries:ObEntry[];time:string;event:string;roles:ObDutyRole[];allRoles?:ObDutyRole[];duties:ObDuty[];members:EntryMember[];operations?:ObEventOperation[];onClose:()=>void}) {
 const [draft,setDraft]=useState<DutyRoleEdit|null>(null),[people,setPeople]=useState<{role:ObDutyRole;selected:string[];expected:{profileId:string;revision:number}[]}|null>(null);
 const [saving,setSaving]=useState(false),[discard,setDiscard]=useState(false);
 const [deleted,setDeleted]=useState<string[]>([]);
 const deleting=useRef(false);
 const visibleRoles=roles.filter(role=>!deleted.includes(role.id));
 const router=useRouter();const {showToast}=useToast();
 const [message,setMessage]=useState("");
 const allIssues=obDutyIssues(entries,members,duties,allRoles,operations);
 const {unread:issues}=useObDutyReview(allIssues);
 const snapshot=()=>duties.filter(d=>d.slot_time===time&&d.event_name===event).map(d=>({profileId:d.profile_id,revision:d.revision}));
 const slot=OB_DUTY_SLOTS.find(s=>s.time===time&&s.label===event)!;
 const slotDuty=(profileId:string)=>duties.find(d=>d.profile_id===profileId&&d.slot_time===time&&d.event_name===event);
 const rolePeople=(id:string)=>duties.filter(d=>d.slot_time===time&&d.event_name===event&&d.role_ids?.includes(id));
 const roster=dutyRows(entries,members);
 const member=(id:string)=>{const row=roster.find(x=>x.id===id);return row?{id,display_name:row.name,grade:row.grade}:members.find(x=>x.id===id);};
 const byGrade=(a:ObDuty,b:ObDuty)=>compareByGrade({grade:member(a.profile_id)?.grade??null,name:member(a.profile_id)?.display_name??""},{grade:member(b.profile_id)?.grade??null,name:member(b.profile_id)?.display_name??""});
 const peopleOriginal=people?rolePeople(people.role.id).map(d=>d.profile_id):[];
 const peopleDirty=!!people&&[...people.selected].sort().join()!==[...peopleOriginal].sort().join();
 const unavailable=(profileId:string,entry:ObEntry|undefined)=>entry?.absent===true||ObMeetRoster.cell(entry,slot,operations).events.length>0||concurrentDuties(profileId,time,event,duties).length>0;
 const candidates=roster.filter(r=>(r.linked||!r.entry?.profile_id)&&!unavailable(r.id,r.entry));
 // 現在の担当者は候補から外れても解除できるよう、別枠に残す。
 const excludedAssigned=peopleOriginal.filter(id=>!candidates.some(r=>r.id===id));
 async function removeRole(role:ObDutyRole){
  if(saving||deleting.current)return false;
  deleting.current=true;setSaving(true);
  try{
   const result=await deleteDutyRole({id:role.id,slotTime:time,eventName:event,revision:role.revision});
   if(!result.ok){showToast(result.message??"削除できませんでした");router.refresh();return false;}
   setDeleted(ids=>[...ids,role.id]);router.refresh();showToast("役職を削除しました","success");return true;
  }catch{showToast("削除できませんでした。接続を確認してやり直してください");return false;}
  finally{deleting.current=false;setSaving(false);}
 }
 async function saveRole(){if(!draft)return;setSaving(true);try{const result=await saveDutyRole(draft);if(!result.ok){showToast(result.message??"保存できませんでした");return;}router.refresh();setDraft(null);showToast("役職を保存しました","success");}catch{showToast("保存できませんでした");}finally{setSaving(false);}}
 async function savePeople(){
  if(!people)return;
  if(people.selected.some(id=>!peopleOriginal.includes(id)&&!candidates.some(r=>r.id===id))){showToast("候補の予定が変わりました。画面を開き直して確認してください");return;}
  setSaving(true);
  setMessage("");
  try{
   const result=await saveDutyPeople({roleId:people.role.id,revision:people.role.revision,expected:people.expected,people:people.selected});
   if(!result.ok){setMessage(result.message??"保存できませんでした。選択は残っています");router.refresh();return;}
   showToast("補助員を保存しました","success");router.refresh();setPeople(null);
  }catch{setMessage("通信できませんでした。選択は残っています。接続を確認して再度保存してください");}finally{setSaving(false);}
 }

 return <FormModal open title={draft?"役職の設定":people?`${people.role.name}の担当者`:"補助員一覧"} autoFocus={false} onOpenChange={open=>{if(!open&&!saving){if(draft||peopleDirty)setDiscard(true);else if(people)setPeople(null);else onClose();}}}>
 <div className="space-y-4"><h2 className="text-headline">{time}　{event}</h2>
 <ObDutyIssues issues={allIssues.filter(issue=>issue.time===time&&issue.event===event)}/>
 {message&&<p role="alert" className="text-body text-danger">{message}</p>}
 {draft?<div className="space-y-4">
  <label className="block text-body">役職名<Input value={draft.name} maxLength={200} disabled={saving} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
  <label className="block text-body">表の略称（1〜8文字）<Input value={draft.abbreviation} maxLength={8} disabled={saving} onChange={e=>setDraft({...draft,abbreviation:e.target.value})}/></label>
  <label className="block text-body">必要人数<Input type="number" min={0} max={99} step={1} value={Number.isNaN(draft.requiredCount)?"":draft.requiredCount} disabled={saving} onChange={e=>setDraft({...draft,requiredCount:e.target.value===""?NaN:Number(e.target.value)})}/></label>
  <p className="text-caption">割当済みの人数より少なくはできません。不要な役職は、担当を解除してから一覧の「…」で削除できます。</p>
 </div>:people?<div className="space-y-3">
  <p className="text-body">{people.selected.length} / {people.role.required_count}人</p>
  <p className="text-caption">欠席者を除き、同時刻に出場・別種目の補助担当がない部員を表示しています。DNSでも担当可能とは限りません。</p>
  {excludedAssigned.length>0&&<section className="space-y-2"><h3 className="text-body text-danger">割当済み・予定の確認が必要</h3><p className="text-caption">候補の条件から外れています。チェックを外すと担当を解除できます。</p><div data-ui-checklist className="divide-y divide-separator rounded-xl border border-separator">{excludedAssigned.map(id=><label key={id} className="flex min-h-12 items-center gap-3 p-3"><input type="checkbox" className="h-5 w-5 shrink-0" checked={people.selected.includes(id)} disabled={saving} onChange={()=>setPeople({...people,selected:people.selected.includes(id)?people.selected.filter(x=>x!==id):[...people.selected,id]})}/><span className="min-w-0 flex-1"><span className="block truncate text-body" title={member(id)?.display_name}>{entryGrade(member(id)?.grade??null)} {member(id)?.display_name??"名簿確認待ち"}{roster.find(row=>row.id===id)?.entry?.absent&&<span className="ml-2 text-danger">欠席</span>}</span><span className="mt-1 block text-caption text-amber-700">■ この種目の補助担当：{dutyRoleText(slotDuty(id),allRoles)}</span></span></label>)}</div></section>}
  {!candidates.length&&<p className="text-body">候補になる部員がいません。</p>}
  <div data-ui-checklist className="divide-y divide-separator rounded-xl border border-separator">{candidates.map(row=>{
   const checked=people.selected.includes(row.id);
   const full=!checked&&people.selected.length>=people.role.required_count;
   const competition={events:obDutyCompetitionEvents(row.entry,operations)};
   const previous=adjacentCommitments(competition,row.id,time,duties,allRoles,"previous");
   const next=adjacentCommitments(competition,row.id,time,duties,allRoles,"next");
   const here=dutyRoleText(slotDuty(row.id),allRoles);
   return <label data-ui-checklist-row key={row.id} className={`flex items-start gap-3 p-3 ${full?"opacity-50":""}`}>
    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={checked} disabled={saving||full} onChange={()=>setPeople({...people,selected:checked?people.selected.filter(id=>id!==row.id):[...people.selected,row.id]})}/>
    <span className="min-w-0 flex-1"><span title={row.name} className="block truncate text-body"><span className="mr-2 text-caption">{row.grade}</span>{row.name}{!row.linked&&<span className="ml-2 text-caption">参加回答</span>}</span>{here&&<span className="mt-1 block text-caption text-amber-700">■ この種目の補助担当：{here}</span>}
    <CommitmentLine label="前" items={previous}/><CommitmentLine label="次" items={next}/></span>
   </label>;
  })}</div>
 </div>:<>
 <p className="text-caption">割当済み / 必要人数。「人を編集」で担当者を選べます。役職の設定・削除は「…」から行えます。担当者がいる役職は、先に担当を解除してください。</p>
 <div className="grid gap-x-6 lg:grid-cols-2">{visibleRoles.map(role=>{const assigned=rolePeople(role.id);const available=assigned.filter(d=>!allIssues.some(issue=>issue.personId===d.profile_id&&issue.time===time&&issue.event===event)).length;const problem=issues.some(issue=>issue.roleId===role.id||assigned.some(d=>issue.personId===d.profile_id&&issue.time===time&&issue.event===event));return <section key={role.id} className="border-b border-separator py-3"><div data-ui-duty-role-heading className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-headline break-words">{problem&&<span className="mr-1 text-danger">！</span>}{role.name} <span className="text-caption">{role.abbreviation}</span></h3><p className={problem?"text-danger text-body":"text-body"}>{available} / {role.required_count}人{available!==assigned.length&&<span className="ml-2 text-caption">割当 {assigned.length}人</span>}</p></div>
  <div data-ui-group className="flex shrink-0 items-center gap-2"><Button size="sm" variant="outline" disabled={saving} aria-label={`${role.name}の担当者を編集`} onClick={()=>{setMessage("");setPeople({role,selected:assigned.map(d=>d.profile_id),expected:snapshot()});}}>人を編集</Button>
  <ActionMenu triggerLabel={`${role.name}の役職メニュー`} editLabel="役職の設定" onEdit={()=>{if(!saving)setDraft({id:role.id,slotTime:time,eventName:event,name:role.name,abbreviation:role.abbreviation,requiredCount:role.required_count,revision:role.revision});}} onDelete={!assigned.length?()=>removeRole(role):undefined} deleteLabel="役職を削除する" deleteTitle="役職を削除しますか？" deleteDescription={`${time} ${event}の「${role.name}」を削除します。削除した役職は元に戻せません。`}/></div></div>
  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{[...assigned].sort(byGrade).map(d=>{const m=member(d.profile_id);const problems=issues.filter(issue=>issue.personId===d.profile_id&&issue.time===time&&issue.event===event);return <li key={d.profile_id} className={problems.length?"text-body text-danger":"text-body"} title={problems.map(issue=>issue.text).join("。")}><span className="mr-2 text-caption">{entryGrade(m?.grade??null)}</span>{m?.display_name??"名簿確認待ち"}{problems.length>0&&" ！"}</li>;})}</ul>{!assigned.length&&<p className="text-caption">未割当</p>}</section>;})}</div>
 {!visibleRoles.length&&<p className="text-body">役職と必要人数を追加してください。</p>}
 <Button variant="outline" disabled={saving} onClick={()=>setDraft({id:null,slotTime:time,eventName:event,name:"",abbreviation:"",requiredCount:1,revision:null})}>役職を追加</Button>
 </>}
 </div>
 {draft&&<FormModalFooter><Button className="w-full" disabled={saving||!draft.name.trim()||!draft.abbreviation.trim()||!Number.isInteger(draft.requiredCount)} onClick={()=>void saveRole()}>{saving?"保存中…":"保存する"}</Button></FormModalFooter>}
 {people&&<FormModalFooter><Button className="w-full" disabled={saving||!peopleDirty} onClick={()=>void savePeople()}>{saving?"保存中…":"担当者を保存する"}</Button></FormModalFooter>}
 <ConfirmDialog open={discard} onOpenChange={setDiscard} title="変更を破棄しますか？" description="保存していない変更は失われます。" confirmLabel="破棄する" onConfirm={()=>{setDraft(null);setPeople(null);setDiscard(false);}}/>
 </FormModal>;
}

function CommitmentLine({label,items}:{label:"前"|"次";items:DutyCommitment[]}) {
 return <span className="mt-0.5 block text-caption">{label}：{items.length?items.map((item,i)=><span key={`${item.kind}-${item.label}`}>{i>0?" ／ ":""}<span className="tabular-nums">{item.time}</span> {item.label}（{item.kind==="競技"?"出場":`補助・${item.detail}`}）</span>):"予定なし"}</span>;
}
