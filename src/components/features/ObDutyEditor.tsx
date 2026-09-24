"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { saveDuty } from "@/app/(app)/ob-entries/actions";
import type { ObDuty } from "@/lib/ob-duty";

export type DutyTarget = {profileId:string;name:string;grade:string;time:string;label:string;entryText:string;competing:boolean;existing?:ObDuty};
export function ObDutyEditor({target,onClose}:{target:DutyTarget;onClose:()=>void}) {
  const [assignment,setAssignment]=useState(target.existing?.assignment ?? "");
  const [saving,setSaving]=useState(false);
  const [confirm,setConfirm]=useState<"discard"|"clear"|null>(null);
  const original=target.existing?.assignment ?? "";
  const dirty=assignment.trim()!==original;
  const router=useRouter();const {showToast}=useToast();
  async function save(value:string) {
    setSaving(true);
    try {
      const result=await saveDuty({profileId:target.profileId,slotTime:target.time,eventName:target.label,assignment:value.trim(),revision:target.existing?.revision??null});
      if(!result.ok){showToast(result.message??"保存できませんでした");setConfirm(null);return;}
      showToast(value.trim()?"補助員の担当を保存しました":"補助員の担当を解除しました","success");router.refresh();onClose();
    } catch {showToast("保存できませんでした");setConfirm(null);} finally {setSaving(false);}
  }
  return <FormModal open autoFocus={false} title="補助員の担当" onOpenChange={(open)=>{if(!open&&!saving&&!confirm){if(dirty)setConfirm("discard");else onClose();}}}>
    <div className="space-y-4">
      <div><p className="text-headline">{target.grade} {target.name}</p><p className="mt-1 text-body">{target.time}　{target.label}</p></div>
      <p className={`text-body ${target.competing?"text-danger":""}`}>{target.competing?"この時間帯に出場登録があります：":"出場予定："}{target.entryText}</p>
      <p className="text-caption">競技の終了時刻・アップ・移動を確認して割り当ててください。</p>
      <div><label htmlFor="ob-duty-assignment" className="mb-2 block text-headline">担当内容</label>
        <Textarea id="ob-duty-assignment" value={assignment} onChange={(e)=>setAssignment(e.target.value)} disabled={saving} maxLength={200} rows={3} placeholder="例：1500mの周回表示、砲丸投げの記録係" />
        <p className="mt-1 text-caption">200文字以内</p>
      </div>
      {original && <Button variant="ghost" disabled={saving} onClick={()=>setConfirm("clear")}>担当を解除する</Button>}
    </div>
    <FormModalFooter><Button className="w-full" disabled={saving||!dirty} onClick={()=>original&&!assignment.trim()?setConfirm("clear"):void save(assignment)}>{saving?"保存中…":"担当を保存する"}</Button></FormModalFooter>
    <ConfirmDialog open={confirm!==null} onOpenChange={(open)=>{if(!open&&!saving)setConfirm(null);}}
      title={confirm==="discard"?"変更を破棄しますか？":"担当を解除しますか？"}
      description={confirm==="discard"?"保存していない変更は失われます。":`${target.name}さんの${target.time} ${target.label}の補助員担当を解除します。競技エントリーは変更しません。`}
      confirmLabel={confirm==="discard"?"破棄する":"解除する"} busy={saving} busyLabel="保存中…" onConfirm={()=>confirm==="discard"?onClose():void save("")} />
  </FormModal>;
}
