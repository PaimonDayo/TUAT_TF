"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import type { EntryMember } from "@/lib/entry-identity";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { saveDutyRoles } from "@/app/(app)/ob-entries/actions";
import type { ObDuty, ObDutyRole } from "@/lib/ob-duty";

export type DutyTarget = {profileId:string;name:string;grade:string;time:string;label:string;entryText:string;competing:boolean;existing?:ObDuty};
export function ObDutyEditor({target,onClose,roles,duties,members}:{target:DutyTarget;onClose:()=>void;roles:ObDutyRole[];duties:ObDuty[];members:EntryMember[]}) {
  const [selected,setSelected]=useState<string[]>(target.existing?.role_ids ?? []);
  const [saving,setSaving]=useState(false);
  const [confirm,setConfirm]=useState<"discard"|"clear"|null>(null);
  const original=target.existing?.role_ids ?? [];
  const dirty=[...selected].sort().join()!==[...original].sort().join();
  const router=useRouter();const {showToast}=useToast();
  async function save(value:string[]) {
    setSaving(true);
    try {
      const result=await saveDutyRoles({profileId:target.profileId,slotTime:target.time,eventName:target.label,roleIds:value,revision:target.existing?.revision??null});
      if(!result.ok){showToast(result.message??"保存できませんでした");setConfirm(null);return;}
      showToast(value.length?"補助員の担当を保存しました":"補助員の担当を解除しました","success");router.refresh();onClose();
    } catch {showToast("保存できませんでした");setConfirm(null);} finally {setSaving(false);}
  }
  return <FormModal open autoFocus={false} title="補助員の担当" onOpenChange={(open)=>{if(!open&&!saving&&!confirm){if(dirty)setConfirm("discard");else onClose();}}}>
    <div className="space-y-4">
      <div><p className="text-headline">{target.grade} {target.name}</p><p className="mt-1 text-body">{target.time}　{target.label}</p></div>
      <p className={`text-body ${target.competing?"text-danger":""}`}>{target.competing?"この時間帯に出場登録があります：":"出場予定："}{target.entryText}</p>
      <p className="text-caption">競技の終了時刻・アップ・移動を確認して割り当ててください。</p>
      <p className="text-caption">複数選択できます。人数はこの部員の選択を含む保存後の人数です。</p>
      {roles.length===0 && <p className="text-body">先に表の種目名から役職と必要人数を追加してください。</p>}
      <div className="space-y-2">{roles.map(role=>{
        const assigned=duties.filter(d=>d.role_ids?.includes(role.id));
        const others=assigned.filter(d=>d.profile_id!==target.profileId);
        const checked=selected.includes(role.id);
        const full=others.length>=role.required_count;
        return <label key={role.id} className="flex items-start gap-3 rounded-xl border border-separator p-3">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} disabled={saving||target.competing||(!checked&&full)} onChange={()=>setSelected(v=>checked?v.filter(id=>id!==role.id):[...v,role.id])}/>
          <span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><span className="text-headline">{role.name} <span className="text-caption">{role.abbreviation}</span></span><span className="text-body whitespace-nowrap">{others.length+(checked?1:0)} / {role.required_count}人</span></span>
          <span className="mt-1 block text-caption">現在：{assigned.length?assigned.map(d=>members.find(m=>m.id===d.profile_id)?.display_name??"名簿確認待ち").join("、"):"未割当"}</span></span>
        </label>;
      })}</div>
      {original.length>0 && <Button variant="ghost" disabled={saving} onClick={()=>setConfirm("clear")}>担当をすべて解除する</Button>}
    </div>
    <FormModalFooter><Button className="w-full" disabled={saving||!dirty||target.competing} onClick={()=>original.length>0&&!selected.length?setConfirm("clear"):void save(selected)}>{saving?"保存中…":"担当を保存する"}</Button></FormModalFooter>
    <ConfirmDialog open={confirm!==null} onOpenChange={(open)=>{if(!open&&!saving)setConfirm(null);}}
      title={confirm==="discard"?"変更を破棄しますか？":"担当を解除しますか？"}
      description={confirm==="discard"?"保存していない変更は失われます。":`${target.name}さんの${target.time} ${target.label}の補助員担当を解除します。競技エントリーは変更しません。`}
      confirmLabel={confirm==="discard"?"破棄する":"解除する"} busy={saving} busyLabel="保存中…" onConfirm={()=>confirm==="discard"?onClose():void save([])} />
  </FormModal>;
}
