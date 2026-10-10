"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FormModal } from "@/components/ui/form-modal";
import { useRouter } from "next/navigation";
import { ObEventOperationsEditor } from "./ObEventOperationsEditor";
import { ObDutyTable } from "./ObDutyTable";
import { OB_PROGRAM, obFamilyLabel as displayEvent } from "@/lib/ob-meet";
import { MeetEvent } from "@/lib/meet-operations";
import { obFamilyRows, obMixedGroupLabel } from "@/lib/ob-mixed-operations";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { EntryMember } from "@/lib/entry-identity";
import { type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { obResultRanks } from "@/lib/ob-result-ranking";

/** One event opens the whole start list, including withdrawals and already recorded results. */
export function ObPublicProgram({ entries, members, duties, roles, operations, view = "program", canEditDuties = false, canEditRecords = false }: {
  view?: "program" | "duties"; canEditDuties?: boolean; canEditRecords?: boolean; entries: ObEntry[]; members: EntryMember[]; duties: ObDuty[]; roles: ObDutyRole[]; operations: ObEventOperation[];
}) {
  const router = useRouter();
  const [record,setRecord]=useState<{event:string;entryId:string}>();
  const [local,setLocal]=useState<ObEventOperation[]>([]);
  const latest=new Map(operations.map(op=>[op.event_name,op]));
  for(const op of local) if(op.revision>(latest.get(op.event_name)?.revision??-1)) latest.set(op.event_name,op);
  const currentOperations=[...latest.values()];
  const [event, setEvent] = useState<string | null>(null);
  const eventRows = (name: string) => obFamilyRows(name, entries, currentOperations);
  const people = event ? eventRows(event) : [];
  const ranks = new Map(["男子", "女子"].flatMap(division => [...obResultRanks(obEventRule(event ?? "100m"), people.filter(row => row.division === division && row.state.canParticipate).map(row => row.performance))]));
  const field = event !== null && obEventRule(event).discipline !== "track";
  return <section className="space-y-3">
    {view === "program" ? <Card className="divide-y divide-separator px-3">
      {OB_PROGRAM.map(slot => <div key={slot.time + slot.label} className="flex gap-3 py-2">
        <span className="w-12 shrink-0 pt-3 text-body font-semibold tabular-nums">{slot.time}</span>
        <div className="min-w-0 flex-1">{slot.events.length ? slot.events.map(name => {
          const rows = eventRows(name);
          const present = rows.filter(row => row.state.canParticipate || row.state.recorded).length;
          const unavailable = rows.length - present;
          return <button key={name} type="button" onClick={() => setEvent(name)} className="flex min-h-14 w-full items-center gap-2 text-left pressable">
            <span className="min-w-0 flex-1 break-words text-body font-medium">{displayEvent(name)}</span>
            <span className="shrink-0 text-right text-caption"><span className="block">{present}人</span>{unavailable > 0 && <span className="block text-micro">DNS {unavailable}</span>}</span><ChevronRight size={16} className="shrink-0 text-muted" />
          </button>;
        }) : <div className="py-3 text-body">{slot.label}{slot.note && <p className="text-caption">{slot.note}</p>}</div>}</div>
      </div>)}
    </Card> : <ObDutyTable onRecord={canEditRecords?(event,entryId)=>setRecord({event,entryId}):undefined} integrated canEditDuties={canEditDuties} entries={entries} members={members} duties={duties} roles={roles} operations={currentOperations} onEvent={name=>setEvent(name.replace(/^(男子|女子)/,""))} />}
    {record&&<ObEventOperationsEditor event={record.event} initialEntryId={record.entryId} entries={entries} initial={latest.get(record.event)} operations={operations} onSaved={saved=>{setLocal(current=>[...current.filter(op=>op.event_name!==saved.event_name),saved]);router.refresh();}} onClose={()=>setRecord(undefined)}/>}
    <FormModal open={event !== null} autoFocus={false} onOpenChange={open => { if (!open) setEvent(null); }} title={displayEvent(event ?? "")}>
      <div className="space-y-4">
        <p className="text-caption">{people.length}人・{field ? "試技順" : "組分け"}と記録</p>
        {people.length ? <ul className="divide-y divide-separator">{people.map(row => {
          const { entry, performance, state, saved, division, eventName, number, group } = row;
          const result = new MeetEvent(obEventRule(eventName), { participants: [performance], confirmed: saved?.data.confirmed ?? false }).best(performance);
          const unavailable = !state.canParticipate && !state.recorded;
          const placement = field ? number === null ? "順番未定" : `試技順 ${number}番` : group !== null ? `${obMixedGroupLabel(group)}${performance.order ? `・${performance.order}${!["1500m", "3000m"].includes(event ?? "") ? "レーン" : "番"}` : ""}` : "組未定";
          return <li key={row.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-3 ${unavailable ? "text-muted" : ""}`}>
            <div className="w-28 shrink-0"><span className="block text-caption">{division}</span><span className="block text-caption">{placement}</span></div>
            <div className="min-w-0 flex-1 basis-36"><p className="break-words text-body font-medium">{entry?.submitted_name ?? "参加情報なし"}<span className="ml-2 text-caption">{entry?.grade}</span></p>{entry?.qualification_marks[eventName] && !state.recorded && <p className="text-micro text-muted2">資格記録 {entry.qualification_marks[eventName]}</p>}</div>
            <div className="min-w-20 text-right">{ranks.has(performance.entryId)&&<p className="text-caption">{ranks.get(performance.entryId)}位</p>}<p className={`text-body ${unavailable ? "text-muted" : "font-semibold tabular-nums"}`}>{state.recorded ? result : state.status === "entered" ? "—" : state.label}</p>{state.recorded && (state.absent || !state.registered) && <p className="text-micro text-muted2">{state.absent ? "以降は欠席" : "DNS・記録保持"}</p>}</div>
          </li>;
        })}</ul> : <p className="text-caption">出場登録はありません。</p>}
      </div>
    </FormModal>
  </section>;
}
