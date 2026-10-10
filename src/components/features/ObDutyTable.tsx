"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ObDutyRoleManager } from "./ObDutyRoleManager";
import type { EntryMember } from "@/lib/entry-identity";
import { normalizeEntryName } from "@/lib/entry-identity";
import { FormModal } from "@/components/ui/form-modal";
import type { ObEntry } from "@/lib/ob-entries";
import { OB_DUTY_SLOTS, dutyRows, dutyTimeCell } from "@/lib/ob-meet";
import { dutyRoleText, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { ObDutyEditor, type DutyTarget } from "./ObDutyEditor";
import { ObMeetRoster, type ObEventOperation } from "@/lib/ob-operations";
import { ObDutyIssues } from "./ObDutyIssues";
import { obDutyIssues } from "@/lib/ob-duty-issues";
import { useObDutyReview } from "./ObDutyReviewProvider";
import { useSearchParams } from "next/navigation";


export function ObDutyTable({entries,members,duties=[],roles=[],operations=[],integrated=false,onEvent,onRecord,canEditDuties=true}:{entries:ObEntry[];members:EntryMember[];duties?:ObDuty[];roles?:ObDutyRole[];operations?:ObEventOperation[];integrated?:boolean;onEvent?:(event:string)=>void;onRecord?:(event:string,entryId:string)=>void;canEditDuties?:boolean}) {
  const [search,setSearch]=useState("");


  const [detail,setDetail]=useState<{name:string;text:string;events:string[];entryId?:string;duty?:DutyTarget;absent?:boolean;dns?:string[]}|null>(null);
  const [editing,setEditing]=useState<DutyTarget|null>(null);

  const [selectedEvent,setSelectedEvent]=useState<typeof OB_DUTY_SLOTS[number]|null>(null);
  const findDuty=(profileId:string,time:string,event:string)=>duties.find((d)=>d.profile_id===profileId&&d.slot_time===time&&d.event_name===event);
  const roster=useMemo(()=>integrated?new ObMeetRoster(entries,members).rows:dutyRows(entries,members).map(row=>({...row,alumni:false})),[entries,members,integrated]);
  const rows=roster.filter((row)=>normalizeEntryName(row.name+row.grade).toLowerCase().includes(normalizeEntryName(search).toLowerCase()));
  const slots=OB_DUTY_SLOTS;
  const issues=useMemo(()=>obDutyIssues(entries,members,duties,roles,operations),[entries,members,duties,roles,operations]);
  const {unread}=useObDutyReview(issues);
  const params=useSearchParams();
  const requested=slots.find(slot=>params.get("issue")===slot.time+"/"+slot.label);
  const shownEvent=selectedEvent??requested;
  function openEvent(time:string,event:string){setSelectedEvent(slots.find(slot=>slot.time===time&&slot.label===event)??null);}
  function closeEvent(){setSelectedEvent(null);const url=new URL(window.location.href);url.searchParams.delete("issue");window.history.replaceState(null,"",url.pathname+url.search);}
  return <div data-ob-workspace className="space-y-4">{integrated?<div className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption"><span className="text-accent">● 出場</span><span className="text-amber-700">■ 補助担当</span><span><span className="ob-concurrent mr-1 inline-block h-3 w-4" />別種目出場</span><span className="text-violet-700">OB・OG</span><span>△ 当日確認</span></div>
    <p className="text-micro text-muted2">DNSでも補助担当の可否は別途確認してください。終了時刻・アップ・移動は未反映です。</p>
  </div>:<Card className="space-y-2 p-4"><h2 className="text-headline">補助員の割り当て</h2>
    <p className="text-caption">種目ごとに担当を登録します。○は同時刻に出場するため補助員に割り当てられない枠です。アップ・移動・競技終了時刻を確認して担当を決めてください。空欄でもアップ・移動時間を考慮してください。リレーは当日確認です。</p>
    <p className="text-caption">学年を問わず、エントリーがある現役部員を表示しています。灰色の行はアプリの部員とまだ照合していない回答です。アプリ未登録でも、参加回答に担当を登録できます。</p>
  </Card>}
  <ObDutyIssues issues={issues} onOpen={openEvent}/>
  <div data-ui-group className="flex items-center gap-2"><Input className="min-w-0 flex-1" aria-label="シフト表の氏名・学年で検索" placeholder="検索" value={search} onChange={(e)=>setSearch(e.target.value)} /></div>
  <p className="text-caption">{rows.length}行・種目名をタップすると補助員一覧が見られます。{canEditDuties && "担当欄をタップすると登録・編集できます。"}</p>
  <Card className="min-w-0 overflow-hidden"><div className="ob-duty-scroll max-h-[65dvh] overflow-auto" tabIndex={0} role="region" aria-label="部員別の出場予定表">
    <table data-ui-table style={integrated?{minWidth:112+slots.length*80}:undefined} className={`w-full table-fixed border-collapse text-left text-[13px] ${integrated?"":"min-w-[1264px] lg:min-w-[1072px]"}`}><caption className="sr-only">{integrated?"現役・OB・OGの出場と補助担当":"補助員検討用の出場予定"}</caption>
      <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 w-28 bg-card p-3 lg:w-28 lg:px-2 lg:py-1.5">氏名・学年</th>{slots.map((s)=><th key={s.label} scope="col" className="w-20 border-l border-separator"><button data-ui-cell type="button" onClick={()=>setSelectedEvent(s)} aria-label={`${s.time} ${s.label}の補助員一覧`} className="min-h-11 w-full p-3 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent lg:px-2 lg:py-1.5"><span className="block tabular-nums">{s.time}</span><span className="font-normal text-accent underline decoration-accent/30 underline-offset-2">{s.label}</span>{unread.some(issue=>issue.time===s.time&&issue.event===s.label)&&<span className="block font-bold text-danger" aria-label="補助員の確認が必要">！</span>}</button></th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id} className={`border-t border-separator ${row.entry?.absent?"bg-bg text-muted":row.alumni?"bg-violet-50/40":row.linked?"":"bg-bg"}`}><th scope="row" className={`sticky left-0 z-10 p-2 font-normal ${row.entry?.absent?"bg-bg text-muted":row.alumni?"bg-violet-50 text-violet-700":row.linked?"bg-card":"bg-bg text-muted"}`}><span className="block truncate text-micro">{row.grade}{row.entry?.absent&&<span className="ml-2 text-danger">欠席</span>}</span><span title={row.name} className="block truncate">{row.name}</span></th>
        {slots.map((slot)=>{const cell=ObMeetRoster.cell(row.entry,slot,operations);const value=row.entry?.absent?"欠席":cell.events.length?cell.events.join("・"):dutyTimeCell(row.entry,slot);const competing=!row.entry?.absent&&cell.events.length>0;const duty=findDuty(row.id,slot.time,slot.label);const slotDns=(cell.own.length?cell.own:cell.events).length>0&&(cell.own.length?cell.own:cell.events).every(event=>cell.dns.includes(event));const assignment=dutyRoleText(duty,roles,true);const problems=unread.filter(issue=>issue.personId===row.id&&issue.time===slot.time&&issue.event===slot.label);return <td key={slot.label} className={`relative border-l border-separator align-top ${problems.length?"ring-1 ring-inset ring-danger/50 bg-danger/10":""} ${integrated?(cell.kind==="concurrent"?"ob-concurrent":cell.kind==="competing"?"bg-accent/5":""):competing?"bg-accent/10":""}`}>
          {integrated?<button data-ui-cell type="button" aria-label={`${row.name} ${slot.time} ${slot.label}：${cell.kind==="absent"?"欠席":cell.kind==="competing"?"出場":cell.kind==="concurrent"?`別種目出場 ${cell.events.join("・")}`:cell.kind==="on-day"?"当日確認":"出場登録なし"}${cell.dns.length?`、DNS ${cell.dns.join("・")}`:""}${assignment?`、補助担当 ${assignment}`:""}`} className="flex min-h-12 w-full flex-col items-center justify-center px-1 py-1 text-center hover:bg-accent/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" onClick={()=>{
            if(onRecord&&cell.events.length||!canEditDuties||row.alumni||(competing||row.entry?.absent)&&!assignment){setDetail({name:row.name,text:`${slot.time} ${slot.label}`,events:cell.events,entryId:row.entry?.id,duty:canEditDuties&&!row.alumni&&assignment?{profileId:row.id,entryId:row.entry?.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,absent:row.entry?.absent,existing:duty}:undefined,absent:row.entry?.absent,dns:cell.dns});return;}
            setEditing({profileId:row.id,entryId:row.entry?.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,absent:row.entry?.absent,existing:duty});
          }}><span aria-hidden className={row.entry?.absent?"text-muted":row.alumni?"text-violet-700":"text-accent"}>{cell.kind==="absent"?"—":slotDns?"DNS":cell.kind==="competing"?"●":cell.kind==="on-day"?"△":"\u00a0"}{problems.length>0&&<span className="font-bold text-danger"> ！</span>}</span>{assignment&&<span title={dutyRoleText(duty,roles)} className="block w-full truncate text-amber-700">■ {assignment}</span>}</button>:
          (row.linked || row.entry ? <div className="min-h-11 px-2 py-1 lg:min-h-8 lg:px-1.5 lg:py-1">
            <p title={value} className={`lg:truncate ${competing&&!row.entry?.absent?"font-medium text-accent":"text-muted2"}`}>{row.entry?.absent?"—":slotDns?"DNS":competing ? "○" : slot.note ? "当日確認" : ""}</p>
            {problems.length>0&&<p className="font-bold text-danger" title={problems.map(issue=>issue.text).join("。")}>！要確認</p>}
            {dutyRoleText(duty,roles) && <p title={dutyRoleText(duty,roles)} className="text-ink truncate">{dutyRoleText(duty,roles,true)}</p>}
            <button data-ui-cell type="button" disabled={!canEditDuties||(competing||row.entry?.absent)&&!assignment} aria-label={`${row.name}の${slot.time} ${slot.label}の補助員担当`} className="absolute inset-0 h-full w-full cursor-pointer disabled:cursor-default hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
              onClick={()=>setEditing({profileId:row.id,entryId:row.entry?.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,absent:row.entry?.absent,existing:duty})} />
          </div> : null)}
        </td>;})}
      </tr>)}</tbody>
    </table>
  </div></Card>{!rows.length&&<p className="py-6 text-center text-caption">条件に合う参加者はいません</p>}{detail&&<FormModal open autoFocus={false} title="出場予定" onOpenChange={open=>!open&&setDetail(null)}><p className="text-headline break-words">{detail.name}</p><p className="mt-2 text-caption">{detail.text}</p>{detail.absent&&<p className="mt-3 text-body text-danger">大会を欠席します</p>}{!!detail.dns?.length&&<p className="mt-3 text-body">DNS：{detail.dns.join("・")}</p>}<div className="mt-4 space-y-2">{detail.duty&&<Button variant="outline" className="w-full" onClick={()=>{setEditing(detail.duty!);setDetail(null);}}>補助担当を変更</Button>}{detail.events.length?detail.events.map(event=><div key={event} className="space-y-2">{onRecord&&detail.entryId&&<Button className="w-full" onClick={()=>{onRecord(event,detail.entryId!);setDetail(null);}}>{event}の記録・DNS</Button>}<Button key={event} className="w-full" variant="outline" disabled={!onEvent} onClick={()=>{setDetail(null);onEvent?.(event);}}>{event}の組・記録</Button></div>):<p className="text-body">この時間の出場登録はありません</p>}</div></FormModal>}{editing && <ObDutyEditor target={editing} roles={roles.filter(r=>r.slot_time===editing.time&&r.event_name===editing.label)} duties={duties} members={[...members,...roster.filter(r=>!r.linked&&!r.alumni).map(r=>({id:r.id,display_name:r.name,grade:r.grade}))]} onClose={()=>setEditing(null)} />}
  {shownEvent && (canEditDuties?<ObDutyRoleManager allRoles={roles} entries={entries} time={shownEvent.time} event={shownEvent.label} roles={roles.filter(r=>r.slot_time===shownEvent.time&&r.event_name===shownEvent.label)} duties={duties} members={members} operations={operations} onClose={closeEvent}/>:<FormModal open title="補助員一覧" onOpenChange={open=>!open&&closeEvent()}><p className="text-caption">補助員の編集にはOB戦担当権限が必要です。</p>{duties.filter(d=>d.slot_time===shownEvent.time&&d.event_name===shownEvent.label&&dutyRoleText(d,roles)).map(d=><p key={d.profile_id} className="py-2 text-body">{roster.find(r=>r.id===d.profile_id)?.name??members.find(m=>m.id===d.profile_id)?.display_name} · {dutyRoleText(d,roles)}{roster.find(r=>r.id===d.profile_id)?.entry?.absent&&<span className="ml-2 text-muted">欠席</span>}</p>)}</FormModal>)}
  </div>;
}
