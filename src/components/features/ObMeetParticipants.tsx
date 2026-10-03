"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { ObDayRegistration } from "./ObDayRegistration";
import { setObAttendance } from "@/app/(app)/ob-entries/operations-actions";
import type { ObEntry } from "@/lib/ob-entries";
import type { ObEventOperation } from "@/lib/ob-operations";
import { dutyRoleText, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { normalizeEntryName } from "@/lib/entry-identity";

export function ObMeetParticipants({entries,duties,roles,operations,details,openDetails=false}:{entries:ObEntry[];duties:ObDuty[];roles:ObDutyRole[];operations:ObEventOperation[];details:ReactNode;openDetails?:boolean}) {
  const [search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[adding,setAdding]=useState(false);
  const [target,setTarget]=useState<ObEntry|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [updates,setUpdates]=useState<ObEntry[]>([]);
  const saving=useRef(false),router=useRouter();
  const roster=entries.map(entry=>{const update=updates.find(value=>value.id===entry.id);return update&&update.revision>entry.revision?update:entry;});
  const normalized=normalizeEntryName(search).toLowerCase();
  const visible=roster.filter(entry=>(filter!=="absent"||entry.absent)&&normalizeEntryName(entry.submitted_name+entry.grade).toLowerCase().includes(normalized));
  const affected=target?duties.filter(duty=>duty.profile_id===(target.profile_id??target.id)&&dutyRoleText(duty,roles)):[];
  async function save() {
    if(!target||saving.current)return;
    saving.current=true;setBusy(true);setMessage("");
    try {
      const result=await setObAttendance({entryId:target.id,revision:target.revision,absent:!target.absent});
      if(!result.ok||result.revision===undefined){setMessage(result.message??"保存できませんでした");return;}
      setUpdates(current=>[...current.filter(entry=>entry.id!==target.id),{...target,revision:result.revision!,absent:!target.absent}]);setTarget(null);router.refresh();
    }catch{setMessage("通信できませんでした。接続を確認して再度保存してください");}
    finally{saving.current=false;setBusy(false);}
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">参加者</h2><p className="text-caption">{roster.length}人 · 大会欠席 {roster.filter(entry=>entry.absent).length}人</p></div><Button onClick={()=>setAdding(true)}>当日エントリー</Button></div>
    <div className="flex gap-2"><Input aria-label="参加者の氏名・学年で検索" placeholder="氏名・学年で検索" value={search} onChange={e=>setSearch(e.target.value)}/><Button variant={filter==="absent"?"secondary":"outline"} aria-pressed={filter==="absent"} onClick={()=>setFilter(filter==="absent"?"all":"absent")}>欠席のみ</Button></div>
    <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">{visible.map(entry=><button key={entry.id} type="button" onClick={()=>{setTarget(entry);setMessage("");}} className="flex min-h-20 items-center gap-3 rounded-xl border border-separator bg-card p-4 text-left"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{entry.submitted_name}<span className="ml-2 text-caption">{entry.grade}</span></p><p className="mt-1 break-words text-caption">{entry.events.join("・")||"競技登録なし"}</p></div><span className={entry.absent?"shrink-0 rounded-full bg-bg px-3 py-1 text-caption":"shrink-0 text-caption"}>{entry.absent?"大会欠席":"出欠を確認"}</span></button>)}</div>
    {!visible.length&&<p className="py-6 text-center text-caption">該当する参加者はいません</p>}
    <details open={openDetails||undefined} className="border-t border-separator pt-3"><summary className="cursor-pointer py-2 text-caption">登録内容・本人照合・懇親会の詳細</summary><div className="mt-3">{details}</div></details>
    {target&&<FormModal open title={target.submitted_name} autoFocus={false} onOpenChange={open=>!open&&!busy&&setTarget(null)}><div className="space-y-4"><h2 className="text-xl font-semibold">{target.absent?"大会欠席を取り消す":"大会全体を欠席にする"}</h2><p className="text-body">{target.absent?"種目別に設定したDNSは、その種目で確認して戻してください。":"1種目だけの欠場は、当日運営の種目画面でDNSにしてください。"}</p><section><h3 className="text-headline">登録種目</h3><p className="mt-1 break-words text-body">{target.events.join("・")||"競技登録なし"}</p></section>{!!affected.length&&<section><h3 className="text-headline">補助担当 {affected.length}件</h3><ul className="mt-2 space-y-2">{affected.map(duty=><li key={duty.slot_time+duty.event_name} className="text-body">{duty.slot_time} {duty.event_name} · {dutyRoleText(duty,roles)}</li>)}</ul><p className="mt-2 text-caption">欠席中は担当人数に数えず、補助員画面から交代できます。</p></section>}<p className="text-caption">保存済みの記録・組番号は保持します。</p>{message&&<div className="space-y-2"><p role="alert" className="text-body text-danger">{message}</p><Button variant="outline" disabled={busy} onClick={()=>{setTarget(null);router.refresh();}}>最新の参加者一覧を確認</Button></div>}</div><FormModalFooter><Button className="w-full" disabled={busy} onClick={()=>void save()}>{busy?"保存中…":target.absent?"欠席を取り消す":"大会欠席にする"}</Button></FormModalFooter></FormModal>}
    {adding&&<ObDayRegistration entries={roster} operations={operations} onSaved={()=>router.refresh()} onClose={()=>setAdding(false)}/>}
  </div>;
}
