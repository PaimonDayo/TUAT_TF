"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { ObDutyTable } from "./ObDutyTable";
import { ObHeatEditor } from "./ObHeatEditor";
import { ObEventOperationsEditor } from "./ObEventOperationsEditor";
import { compareObEvents } from "@/lib/ob-entry-edit";
import { obEventTime } from "@/lib/ob-meet";
import type { ObEntry } from "@/lib/ob-entries";
import type { EntryMember } from "@/lib/entry-identity";
import type { ObDuty, ObDutyRole } from "@/lib/ob-duty";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import { MeetEvent } from "@/lib/meet-operations";

export function ObOperations({entries,members,duties,roles,initial,canEditDuties=true,onlyGroups=false}:{onlyGroups?:boolean;entries:ObEntry[];members:EntryMember[];duties:ObDuty[];roles:ObDutyRole[];initial:ObEventOperation[];canEditDuties?:boolean}) {
  const [view,setView]=useState(onlyGroups?"groups":"table");
  const [local,setSaved]=useState<ObEventOperation[]>([]);
  const latest=new Map(initial.map(s=>[s.event_name,s]));
  for(const value of local)if(!latest.has(value.event_name)||latest.get(value.event_name)!.revision<value.revision)latest.set(value.event_name,value);
  const saved=[...latest.values()];
  const router=useRouter();
  const [event,setEvent]=useState<string|null>(null);
  const Editor=view==="groups"?ObHeatEditor:ObEventOperationsEditor;
  const events=[...new Set([...entries.flatMap(e=>e.events),...saved.map(s=>s.event_name)])].sort(compareObEvents);
  return <div className="space-y-4">{!onlyGroups&&<><p className="text-micro text-muted2">組分け・記録の管理</p><SegmentedControl items={[{key:"table",label:"出場・補助"},{key:"groups",label:"組み分け"},{key:"records",label:"試技記録"}]} value={view} onChange={setView}/></>}
    {view==="table"?<ObDutyTable integrated canEditDuties={canEditDuties} entries={entries} members={members} duties={duties} roles={roles} onEvent={setEvent}/>:<Card className="divide-y divide-separator">{events.map(name=>{const state=saved.find(s=>s.event_name===name),count=entries.filter(e=>e.events.includes(name)).length;const recorded=state?.data.participants.filter(p=>new MeetEvent(obEventRule(name),state.data).best(p)!=="—").length??0;return <div key={name} className="flex items-center gap-3 p-3"><span className="w-12 shrink-0 text-caption tabular-nums">{obEventTime(name)}</span><div className="min-w-0 flex-1"><p className="text-headline">{name}</p><p className="text-caption">{count}人 · {view==="groups"?`${state?.data.participants.filter(p=>p.group&&p.order).length??0}人配置済み`:`${recorded}人記録済み`} · {state?.data.confirmed?"確認済み":"調整中"}</p></div><Button variant="outline" size="sm" aria-label={`${name}の${view==="groups"?"組み分け":"試技記録"}`} onClick={()=>setEvent(name)}>開く</Button></div>})}{!events.length&&<p className="p-6 text-center text-caption">出場登録がある種目はありません</p>}</Card>}
    {event&&<Editor key={event} event={event} entries={entries} initial={saved.find(s=>s.event_name===event)} onSaved={value=>{setSaved(current=>[...current.filter(s=>s.event_name!==value.event_name),value]);router.refresh();}} onClose={()=>setEvent(null)}/>}
  </div>;
}
