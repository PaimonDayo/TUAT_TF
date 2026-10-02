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
import { OB_DUTY_SLOTS, dutyRows, dutyTimeCell, obCsvCell } from "@/lib/ob-meet";
import { dutyRoleText, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { ObDutyEditor, type DutyTarget } from "./ObDutyEditor";
import { ObMeetRoster } from "@/lib/ob-operations";


export function ObDutyTable({entries,members,duties=[],roles=[],integrated=false,onEvent,canEditDuties=true}:{entries:ObEntry[];members:EntryMember[];duties?:ObDuty[];roles?:ObDutyRole[];integrated?:boolean;onEvent?:(event:string)=>void;canEditDuties?:boolean}) {
  const [search,setSearch]=useState("");


  const [detail,setDetail]=useState<{name:string;text:string;events:string[]}|null>(null);
  const [editing,setEditing]=useState<DutyTarget|null>(null);

  const [selectedEvent,setSelectedEvent]=useState<typeof OB_DUTY_SLOTS[number]|null>(null);
  const findDuty=(profileId:string,time:string,event:string)=>duties.find((d)=>d.profile_id===profileId&&d.slot_time===time&&d.event_name===event);
  const roster=useMemo(()=>integrated?new ObMeetRoster(entries,members).rows:dutyRows(entries,members).map(row=>({...row,alumni:false})),[entries,members,integrated]);
  const rows=roster.filter((row)=>normalizeEntryName(row.name+row.grade).toLowerCase().includes(normalizeEntryName(search).toLowerCase()));
  const slots=OB_DUTY_SLOTS;
  function download() {
    const values=[
      ["補助員検討用：開始時刻別の出場登録。終了時刻・アップ・移動は未反映。出場登録なしは担当可能の確約ではありません。"],
      ["学年","氏名","本人照合",...OB_DUTY_SLOTS.flatMap((s)=>[`${s.time} ${s.label}：出場予定`,`${s.time} ${s.label}：補助員担当`])],
      ...rows.map((row)=>[row.grade,row.name,row.alumni?"OB・OG":row.linked?"アプリ名簿":"未照合",...OB_DUTY_SLOTS.flatMap((slot)=>{const cell=ObMeetRoster.cell(row.entry,slot);return [integrated?(cell.kind==="competing"?"出場":cell.kind==="concurrent"?`別種目：${cell.events.join("・")}`:cell.kind==="on-day"?"当日確認":""):(slot.note ? "当日確認" : dutyTimeCell(row.entry,slot)==="出場登録なし" || dutyTimeCell(row.entry,slot)==="エントリー未確認" ? "" : "○"),dutyRoleText(findDuty(row.id,slot.time,slot.label),roles)]})]),
    ];
    const blob=new Blob(["\uFEFF"+values.map((row)=>row.map(obCsvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");a.href=url;a.download=integrated?"OB戦_出場・補助員表.csv":"OB戦_補助員検討表.csv";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="space-y-4">{integrated?<div className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption"><span className="text-accent">● 出場</span><span className="text-amber-700">■ 補助担当</span><span><span className="ob-concurrent mr-1 inline-block h-3 w-4" />別種目出場</span><span className="text-violet-700">OB・OG</span><span>△ 当日確認</span></div>
    <p className="text-micro text-muted2">同じ開始時刻の出場を表示。終了時刻・アップ・移動は別途確認してください。空欄は補助可能の確約ではありません。</p>
  </div>:<Card className="space-y-2 p-4"><h2 className="text-headline">補助員の割り当て</h2>
    <p className="text-caption">種目ごとに担当を登録します。○は同時刻に出場するため補助員に割り当てられない枠です。アップ・移動・競技終了時刻を確認して担当を決めてください。空欄でもアップ・移動時間を考慮してください。リレーは当日確認です。</p>
    <p className="text-caption">学年を問わず、エントリーがある現役部員を表示しています。灰色の行はアプリの部員とまだ照合していない回答です。アプリ未登録でも、参加回答に担当を登録できます。</p>
  </Card>}
  <div data-ui-group className="flex items-center gap-2"><Input className="min-w-0 flex-1" aria-label="補助員表の氏名・学年で検索" placeholder="検索" value={search} onChange={(e)=>setSearch(e.target.value)} /><Button size="sm" variant="outline" onClick={download}>CSV出力</Button></div>
  <p className="text-caption">{rows.length}行・種目名をタップすると補助員一覧、担当欄をタップすると登録・編集できます。CSVにも保存済みの担当が出ます。</p>
  <Card className="min-w-0 overflow-hidden"><div className="ob-duty-scroll max-h-[65dvh] overflow-auto" tabIndex={0} role="region" aria-label="部員別の出場予定表">
    <table data-ui-table style={integrated?{minWidth:112+slots.length*80}:undefined} className={`w-full table-fixed border-collapse text-left text-[13px] ${integrated?"":"min-w-[1264px] lg:min-w-[1072px]"}`}><caption className="sr-only">{integrated?"現役・OB・OGの出場と補助担当":"補助員検討用の出場予定"}</caption>
      <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 w-28 bg-card p-3 lg:w-28 lg:px-2 lg:py-1.5">氏名・学年</th>{slots.map((s)=><th key={s.label} scope="col" className="w-20 border-l border-separator"><button data-ui-cell type="button" onClick={()=>setSelectedEvent(s)} aria-label={`${s.time} ${s.label}の補助員一覧`} className="min-h-11 w-full p-3 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent lg:px-2 lg:py-1.5"><span className="block tabular-nums">{s.time}</span><span className="font-normal text-accent underline decoration-accent/30 underline-offset-2">{s.label}</span></button></th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id} className={`border-t border-separator ${row.alumni?"bg-violet-50/40":row.linked?"":"bg-bg"}`}><th scope="row" className={`sticky left-0 z-10 p-2 font-normal ${row.alumni?"bg-violet-50 text-violet-700":row.linked?"bg-card":"bg-bg text-muted"}`}><span className="block truncate text-micro">{row.grade}</span><span title={row.name} className="block truncate">{row.name}</span></th>
        {slots.map((slot)=>{const value=dutyTimeCell(row.entry,slot);const competing=value!=="出場登録なし"&&value!=="エントリー未確認"&&value!=="当日確認";const duty=findDuty(row.id,slot.time,slot.label);const cell=ObMeetRoster.cell(row.entry,slot);const assignment=dutyRoleText(duty,roles,true);return <td key={slot.label} className={`relative border-l border-separator align-top ${integrated?(cell.kind==="concurrent"?"ob-concurrent":cell.kind==="competing"?"bg-accent/5":""):competing?"bg-accent/10":""}`}>
          {integrated?<button data-ui-cell type="button" aria-label={`${row.name} ${slot.time} ${slot.label}：${cell.kind==="competing"?"出場":cell.kind==="concurrent"?`別種目出場 ${cell.events.join("・")}`:cell.kind==="on-day"?"当日確認":"出場登録なし"}${assignment?`、補助担当 ${assignment}`:""}`} className="flex min-h-12 w-full flex-col items-center justify-center px-1 py-1 text-center hover:bg-accent/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" onClick={()=>{
            if(!canEditDuties||row.alumni||competing&&!assignment){setDetail({name:row.name,text:`${slot.time} ${slot.label}`,events:cell.events});return;}
            setEditing({profileId:row.id,entryId:row.entry?.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,existing:duty});
          }}><span aria-hidden className={row.alumni?"text-violet-700":"text-accent"}>{cell.kind==="competing"?"●":cell.kind==="on-day"?"△":"\u00a0"}{competing&&assignment&&<span className="text-danger"> !</span>}</span>{assignment&&<span title={dutyRoleText(duty,roles)} className="block w-full truncate text-amber-700">■ {assignment}</span>}</button>:
          (row.linked || row.entry ? <div className="min-h-11 px-2 py-1 lg:min-h-8 lg:px-1.5 lg:py-1">
            <p title={value} className={`lg:truncate ${competing?"font-medium text-accent":"text-muted2"}`}>{competing ? "○" : slot.note ? "当日確認" : ""}</p>
            {dutyRoleText(duty,roles) && <p title={dutyRoleText(duty,roles)} className="text-ink truncate">{dutyRoleText(duty,roles,true)}</p>}
            <button data-ui-cell type="button" disabled={competing&&!duty?.assignment} aria-label={`${row.name}の${slot.time} ${slot.label}の補助員担当`} className="absolute inset-0 h-full w-full cursor-pointer disabled:cursor-default hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
              onClick={()=>setEditing({profileId:row.id,entryId:row.entry?.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,existing:duty})} />
          </div> : null)}
        </td>;})}
      </tr>)}</tbody>
    </table>
  </div></Card>{!rows.length&&<p className="py-6 text-center text-caption">条件に合う参加者はいません</p>}{detail&&<FormModal open autoFocus={false} title="出場予定" onOpenChange={open=>!open&&setDetail(null)}><p className="text-headline break-words">{detail.name}</p><p className="mt-2 text-caption">{detail.text}</p><div className="mt-4 space-y-2">{detail.events.length?detail.events.map(event=><Button key={event} className="w-full" variant="outline" onClick={()=>{setDetail(null);onEvent?.(event);}}>{event}の組・記録</Button>):<p className="text-body">この時間の出場登録はありません</p>}</div></FormModal>}{editing && <ObDutyEditor target={editing} roles={roles.filter(r=>r.slot_time===editing.time&&r.event_name===editing.label)} duties={duties} members={[...members,...roster.filter(r=>!r.linked&&!r.alumni).map(r=>({id:r.id,display_name:r.name,grade:r.grade}))]} onClose={()=>setEditing(null)} />}
  {selectedEvent && (canEditDuties?<ObDutyRoleManager allRoles={roles} entries={entries} time={selectedEvent.time} event={selectedEvent.label} roles={roles.filter(r=>r.slot_time===selectedEvent.time&&r.event_name===selectedEvent.label)} duties={duties} members={members} onClose={()=>setSelectedEvent(null)}/>:<FormModal open title="補助員一覧" onOpenChange={open=>!open&&setSelectedEvent(null)}><p className="text-caption">補助員の編集にはOB戦担当権限が必要です。</p>{duties.filter(d=>d.slot_time===selectedEvent.time&&d.event_name===selectedEvent.label&&dutyRoleText(d,roles)).map(d=><p key={d.profile_id} className="py-2 text-body">{members.find(m=>m.id===d.profile_id)?.display_name??roster.find(r=>r.id===d.profile_id)?.name} · {dutyRoleText(d,roles)}</p>)}</FormModal>)}
  </div>;
}
