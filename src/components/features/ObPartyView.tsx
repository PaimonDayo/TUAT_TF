"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { saveParty } from "@/app/(app)/ob-entries/actions";
import { normalizeEntryName } from "@/lib/entry-identity";
import { OB_PARTY, PARTY_STATUSES, partyCounts, type ObPartyResponse, type PartyStatus } from "@/lib/ob-meet";

export function ObPartyView({ responses }: { responses: ObPartyResponse[] }) {
  const [search,setSearch] = useState("");
  const [status,setStatus] = useState("all");
  const [editing,setEditing] = useState<ObPartyResponse | null>(null);
  const count = partyCounts(responses);
  const rows = responses.filter((p) => normalizeEntryName(p.submitted_name+p.group_label).includes(normalizeEntryName(search)) &&
    (status === "all" || (status === "held" ? p.needs_review : !p.needs_review && p.status === status)));
  return <div className="space-y-4">
    <Card className="space-y-2 p-4"><h2 className="text-headline">懇親会</h2>
      <p className="text-body">{OB_PARTY.time} {OB_PARTY.venue}<br />参加費 {OB_PARTY.fee.toLocaleString()}円</p>
      <p className="text-body">参加 {count.attending}人・不参加 {count.absent}人・未回答 {count.unknown}人</p>
      {count.held > 0 && <p className="text-caption">氏名未確認 {count.held}件は人数に含めていません。</p>}
    </Card>
    <Input aria-label="懇親会の氏名・区分で検索" placeholder="氏名・区分で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
    <Select value={status} onValueChange={setStatus} ariaLabel="懇親会の出欠で絞り込み" options={[{value:"all",label:"すべて"},...PARTY_STATUSES.map((s) => ({value:s,label:s})),{value:"held",label:"確認待ち"}]} />
    <Card className="divide-y divide-separator">{rows.length ? rows.map((p) => <div key={p.id} className="flex items-center gap-2 p-3.5">
      <div className="min-w-0 flex-1"><p className="text-caption">{p.group_label}</p><p className="break-words text-body">{p.submitted_name}</p></div>
      <span className="shrink-0 text-body">{p.needs_review ? `確認待ち（${p.status}）` : p.status}</span>
      {!p.needs_review && <ActionMenu triggerLabel={`${p.submitted_name}の懇親会の操作`} onEdit={() => setEditing(p)} editLabel="懇親会の出欠を編集" />}
    </div>) : <EmptyState title="該当する回答はありません" />}</Card>
    {editing && <PartyEditor key={`${editing.id}:${editing.revision}`} response={editing} onClose={() => setEditing(null)} />}
  </div>;
}

function PartyEditor({response,onClose}:{response:ObPartyResponse;onClose:()=>void}) {
  const [status,setStatus]=useState<PartyStatus>(response.status);
  const [saving,setSaving]=useState(false);
  const [discard,setDiscard]=useState(false);
  const {showToast}=useToast(); const router=useRouter();
  async function save() {
    setSaving(true);
    try { const result=await saveParty({id:response.id,revision:response.revision,status});
      if(!result.ok) {showToast(result.message??"保存できませんでした");return;}
      showToast("懇親会の出欠を保存しました","success");router.refresh();onClose();
    } catch {showToast("保存できませんでした");} finally {setSaving(false);}
  }
  return <FormModal open autoFocus={false} title="懇親会の出欠" onOpenChange={(open)=>{if(!open&&!saving){if(status!==response.status)setDiscard(true);else onClose();}}}>
    <div className="space-y-4"><p className="text-headline">{response.group_label} {response.submitted_name}</p>
      <p className="text-body">{OB_PARTY.time} {OB_PARTY.venue}<br />参加費 {OB_PARTY.fee.toLocaleString()}円</p>
      <Select value={status} disabled={saving} onValueChange={(v)=>setStatus(v as PartyStatus)} ariaLabel="懇親会の出欠" options={PARTY_STATUSES.map((v)=>({value:v,label:v}))} />
    </div>
    <FormModalFooter><Button className="w-full" disabled={saving||status===response.status} onClick={()=>void save()}>{saving?"保存中…":"変更を保存する"}</Button></FormModalFooter>
    <ConfirmDialog open={discard} onOpenChange={setDiscard} title="変更を破棄しますか？" description="保存していない変更は失われます。" confirmLabel="破棄する" onConfirm={onClose} />
  </FormModal>;
}
