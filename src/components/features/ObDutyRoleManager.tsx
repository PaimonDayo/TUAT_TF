"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {FormModal,FormModalFooter} from "@/components/ui/form-modal";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ConfirmDialog} from "@/components/ui/confirm-dialog";
import {useToast} from "@/components/ui/toast";
import {saveDutyRole,saveDutyRoles} from "@/app/(app)/ob-entries/actions";
import {nextCommitment,type ObDuty,type ObDutyRole,type DutyRoleEdit} from "@/lib/ob-duty";
import {OB_DUTY_SLOTS,compareByGrade,dutyRows,dutyTimeCell,isCompeting} from "@/lib/ob-meet";
import type {ObEntry} from "@/lib/ob-entries";
import {entryGrade,type EntryMember} from "@/lib/entry-identity";

/**
 * 種目の補助員一覧。役職ごとに「人を編集」で担当者を選ぶ（2026-09-26 オーナー指示）。
 * 候補はその時間帯に出場しない部員を学年順（B1から）に並べ、次の競技・補助員と時刻を添える。
 * 役職名・必要人数の変更は「設定」から。
 */
export function ObDutyRoleManager({entries,time,event,roles,duties,members,onClose}:{entries:ObEntry[];time:string;event:string;roles:ObDutyRole[];duties:ObDuty[];members:EntryMember[];onClose:()=>void}) {
 const [draft,setDraft]=useState<DutyRoleEdit|null>(null),[people,setPeople]=useState<{role:ObDutyRole;selected:string[]}|null>(null);
 const [saving,setSaving]=useState(false),[discard,setDiscard]=useState(false);
 const router=useRouter();const {showToast}=useToast();
 const slot=OB_DUTY_SLOTS.find(s=>s.time===time&&s.label===event)!;
 const slotDuty=(profileId:string)=>duties.find(d=>d.profile_id===profileId&&d.slot_time===time&&d.event_name===event);
 const rolePeople=(id:string)=>duties.filter(d=>d.slot_time===time&&d.event_name===event&&d.role_ids?.includes(id));
 const member=(id:string)=>members.find(x=>x.id===id);
 const byGrade=(a:ObDuty,b:ObDuty)=>compareByGrade({grade:member(a.profile_id)?.grade??null,name:member(a.profile_id)?.display_name??""},{grade:member(b.profile_id)?.grade??null,name:member(b.profile_id)?.display_name??""});
 const peopleOriginal=people?rolePeople(people.role.id).map(d=>d.profile_id):[];
 const peopleDirty=!!people&&[...people.selected].sort().join()!==[...peopleOriginal].sort().join();
 // 候補: エントリー済みでアプリの名簿と照合できた現役部員のうち、この時間帯に出場しない人（学年順）。
 const candidates=dutyRows(entries,members).filter(r=>r.linked&&!isCompeting(dutyTimeCell(r.entry,slot)));
 async function saveRole(){if(!draft)return;setSaving(true);try{const result=await saveDutyRole(draft);if(!result.ok){showToast(result.message??"保存できませんでした");return;}router.refresh();setDraft(null);showToast("役職を保存しました","success");}catch{showToast("保存できませんでした");}finally{setSaving(false);}}
 async function savePeople(){
  if(!people)return;setSaving(true);
  const role=people.role.id;
  const removed=peopleOriginal.filter(id=>!people.selected.includes(id)),added=people.selected.filter(id=>!peopleOriginal.includes(id));
  try{
   // 外す人を先に保存して、必要人数の上限に引っかからないようにする。
   for(const profileId of [...removed,...added]){
    const current=slotDuty(profileId);const ids=current?.role_ids??[];
    const result=await saveDutyRoles({profileId,slotTime:time,eventName:event,roleIds:removed.includes(profileId)?ids.filter(x=>x!==role):[...ids,role],revision:current?.revision??null});
    if(!result.ok){showToast(`${member(profileId)?.display_name??""}：${result.message??"保存できませんでした"}`);router.refresh();return;}
   }
   showToast("補助員を保存しました","success");router.refresh();setPeople(null);
  }catch{showToast("保存できませんでした");router.refresh();}finally{setSaving(false);}
 }
 return <FormModal open title={draft?"役職の設定":people?`${people.role.name}の担当者`:"補助員一覧"} autoFocus={false} onOpenChange={open=>{if(!open&&!saving){if(draft||peopleDirty)setDiscard(true);else if(people)setPeople(null);else onClose();}}}>
 <div className="space-y-4"><h2 className="text-headline">{time}　{event}</h2>
 {draft?<div className="space-y-4">
  <label className="block text-body">役職名<Input value={draft.name} maxLength={200} disabled={saving} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
  <label className="block text-body">表の略称（1〜8文字）<Input value={draft.abbreviation} maxLength={8} disabled={saving} onChange={e=>setDraft({...draft,abbreviation:e.target.value})}/></label>
  <label className="block text-body">必要人数<Input type="number" min={0} max={99} step={1} value={Number.isNaN(draft.requiredCount)?"":draft.requiredCount} disabled={saving} onChange={e=>setDraft({...draft,requiredCount:e.target.value===""?NaN:Number(e.target.value)})}/></label>
  <p className="text-caption">割当済みの人数より少なくはできません。使わない役職は、担当を解除して必要人数を0にできます。</p>
 </div>:people?<div className="space-y-3">
  <p className="text-body">{people.selected.length} / {people.role.required_count}人</p>
  <p className="text-caption">この時間帯に出場しない部員を学年順に表示しています。下の行は次の競技・補助員とその時刻です。アップ・移動の時間を確認して選んでください。</p>
  {!candidates.length&&<p className="text-body">候補になる部員がいません。</p>}
  <div className="divide-y divide-separator rounded-xl border border-separator">{candidates.map(row=>{
   const checked=people.selected.includes(row.id);
   const full=!checked&&people.selected.length>=people.role.required_count;
   const next=nextCommitment(row.entry,row.id,time,duties,roles);
   const here=(slotDuty(row.id)?.role_ids??[]).filter(id=>id!==people.role.id).map(id=>roles.find(r=>r.id===id)?.abbreviation).filter(Boolean);
   return <label key={row.id} className={`flex items-start gap-3 p-3 ${full?"opacity-50":""}`}>
    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={checked} disabled={saving||full} onChange={()=>setPeople({...people,selected:checked?people.selected.filter(id=>id!==row.id):[...people.selected,row.id]})}/>
    <span className="min-w-0 flex-1"><span className="block text-body"><span className="mr-2 text-caption">{row.grade}</span>{row.name}{here.length>0&&<span className="ml-2 text-caption">この種目：{here.join("・")}</span>}</span>
    <span className="mt-0.5 block text-caption">{next?<>次：<span className="tabular-nums">{next.time}</span> {next.label}（{next.kind==="競技"?"出場":`補助員・${next.detail}`}）</>:"このあとの予定なし"}</span></span>
   </label>;
  })}</div>
 </div>:<>
 <p className="text-caption">割当済み / 必要人数。「人を編集」で担当者を選べます。</p>
 <div className="divide-y divide-separator">{roles.map(role=>{const assigned=rolePeople(role.id);return <section key={role.id} className="py-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-headline">{role.name} <span className="text-caption">{role.abbreviation}</span></h3><p className={assigned.length<role.required_count?"text-accent text-body":"text-body"}>{assigned.length} / {role.required_count}人</p></div>
  <div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" aria-label={`${role.name}の役職の設定`} onClick={()=>setDraft({id:role.id,slotTime:time,eventName:event,name:role.name,abbreviation:role.abbreviation,requiredCount:role.required_count,revision:role.revision})}>設定</Button>
  <Button size="sm" variant="outline" aria-label={`${role.name}の担当者を編集`} onClick={()=>setPeople({role,selected:assigned.map(d=>d.profile_id)})}>人を編集</Button></div></div>
  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{[...assigned].sort(byGrade).map(d=>{const m=member(d.profile_id);return <li key={d.profile_id} className="text-body"><span className="mr-2 text-caption">{entryGrade(m?.grade??null)}</span>{m?.display_name??"名簿確認待ち"}</li>;})}</ul>{!assigned.length&&<p className="text-caption">未割当</p>}</section>;})}</div>
 {!roles.length&&<p className="text-body">役職と必要人数を追加してください。</p>}
 <Button variant="outline" onClick={()=>setDraft({id:null,slotTime:time,eventName:event,name:"",abbreviation:"",requiredCount:1,revision:null})}>役職を追加</Button>
 </>}
 </div>
 {draft&&<FormModalFooter><Button className="w-full" disabled={saving||!draft.name.trim()||!draft.abbreviation.trim()||!Number.isInteger(draft.requiredCount)} onClick={()=>void saveRole()}>{saving?"保存中…":"保存する"}</Button></FormModalFooter>}
 {people&&<FormModalFooter><Button className="w-full" disabled={saving||!peopleDirty} onClick={()=>void savePeople()}>{saving?"保存中…":"担当者を保存する"}</Button></FormModalFooter>}
 <ConfirmDialog open={discard} onOpenChange={setDiscard} title="変更を破棄しますか？" description="保存していない変更は失われます。" confirmLabel="破棄する" onConfirm={()=>{setDraft(null);setPeople(null);setDiscard(false);}}/>
 </FormModal>;
}
