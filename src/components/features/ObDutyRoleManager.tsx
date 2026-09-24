"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {FormModal,FormModalFooter} from "@/components/ui/form-modal";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ConfirmDialog} from "@/components/ui/confirm-dialog";
import {useToast} from "@/components/ui/toast";
import {saveDutyRole} from "@/app/(app)/ob-entries/actions";
import type {ObDuty,ObDutyRole,DutyRoleEdit} from "@/lib/ob-duty";
import {entryGrade,type EntryMember} from "@/lib/entry-identity";
export function ObDutyRoleManager({time,event,roles,duties,members,onClose}:{time:string;event:string;roles:ObDutyRole[];duties:ObDuty[];members:EntryMember[];onClose:()=>void}) {
 const [draft,setDraft]=useState<DutyRoleEdit|null>(null),[saving,setSaving]=useState(false),[discard,setDiscard]=useState(false);
 const router=useRouter();const {showToast}=useToast();
 const rolePeople=(id:string)=>duties.filter(d=>d.role_ids?.includes(id));
 async function save(){if(!draft)return;setSaving(true);try{const result=await saveDutyRole(draft);if(!result.ok){showToast(result.message??"保存できませんでした");return;}router.refresh();setDraft(null);showToast("役職と必要人数を保存しました","success");}catch{showToast("保存できませんでした");}finally{setSaving(false);}}
 return <FormModal open title={draft?"役職と必要人数":"補助員一覧"} autoFocus={false} onOpenChange={open=>{if(!open&&!saving){if(draft)setDiscard(true);else onClose();}}}>
 <div className="space-y-4"><h2 className="text-headline">{time}　{event}</h2>
 {draft?<div className="space-y-4">
  <label className="block text-body">役職名<Input value={draft.name} maxLength={200} disabled={saving} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
  <label className="block text-body">表の略称（1〜8文字）<Input value={draft.abbreviation} maxLength={8} disabled={saving} onChange={e=>setDraft({...draft,abbreviation:e.target.value})}/></label>
  <label className="block text-body">必要人数<Input type="number" min={0} max={99} step={1} value={Number.isNaN(draft.requiredCount)?"":draft.requiredCount} disabled={saving} onChange={e=>setDraft({...draft,requiredCount:e.target.value===""?NaN:Number(e.target.value)})}/></label>
  <p className="text-caption">割当済みの人数より少なくはできません。使わない役職は、担当を解除して必要人数を0にできます。</p>
 </div>:<>
 <p className="text-caption">割当済み / 必要人数。役職を編集して、必要人数と表の略称を変更できます。</p>
 <div className="divide-y divide-separator">{roles.map(role=>{const people=rolePeople(role.id);return <section key={role.id} className="py-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-headline">{role.name} <span className="text-caption">{role.abbreviation}</span></h3><p className={people.length<role.required_count?"text-accent text-body":"text-body"}>{people.length} / {role.required_count}人</p></div><Button size="sm" variant="outline" aria-label={`${role.name}を編集`} onClick={()=>setDraft({id:role.id,slotTime:time,eventName:event,name:role.name,abbreviation:role.abbreviation,requiredCount:role.required_count,revision:role.revision})}>編集</Button></div><ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{people.map(d=>{const m=members.find(x=>x.id===d.profile_id);return <li key={d.profile_id} className="text-body"><span className="mr-2 text-caption">{entryGrade(m?.grade??null)}</span>{m?.display_name??"名簿確認待ち"}</li>;})}</ul>{!people.length&&<p className="text-caption">未割当</p>}</section>;})}</div>
 {!roles.length&&<p className="text-body">役職と必要人数を追加してください。</p>}
 <Button variant="outline" onClick={()=>setDraft({id:null,slotTime:time,eventName:event,name:"",abbreviation:"",requiredCount:1,revision:null})}>役職を追加</Button>
 </>}
 </div>
 {draft&&<FormModalFooter><Button className="w-full" disabled={saving||!draft.name.trim()||!draft.abbreviation.trim()||!Number.isInteger(draft.requiredCount)} onClick={()=>void save()}>{saving?"保存中…":"保存する"}</Button></FormModalFooter>}
 <ConfirmDialog open={discard} onOpenChange={setDiscard} title="変更を破棄しますか？" description="保存していない役職の変更は失われます。" confirmLabel="破棄する" onConfirm={()=>{setDraft(null);setDiscard(false);}}/>
 </FormModal>;
}
