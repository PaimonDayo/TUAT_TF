"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ObDutyRoleManager } from "./ObDutyRoleManager";
import type { EntryMember } from "@/lib/entry-identity";
import { normalizeEntryName } from "@/lib/entry-identity";
import type { ObEntry } from "@/lib/ob-entries";
import { OB_DUTY_SLOTS, dutyRows, dutyTimeCell, obCsvCell } from "@/lib/ob-meet";
import { dutyRoleText, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { ObDutyEditor, type DutyTarget } from "./ObDutyEditor";

export function ObDutyTable({entries,members,duties=[],roles=[]}:{entries:ObEntry[];members:EntryMember[];duties?:ObDuty[];roles?:ObDutyRole[]}) {
  const [search,setSearch]=useState("");
  const [editing,setEditing]=useState<DutyTarget|null>(null);
  const [selectedEvent,setSelectedEvent]=useState<typeof OB_DUTY_SLOTS[number]|null>(null);
  const findDuty=(profileId:string,time:string,event:string)=>duties.find((d)=>d.profile_id===profileId&&d.slot_time===time&&d.event_name===event);
  const rows=dutyRows(entries,members).filter((row)=>normalizeEntryName(row.name+row.grade).includes(normalizeEntryName(search)));
  function download() {
    const values=[
      ["補助員検討用：開始時刻別の出場登録。終了時刻・アップ・移動は未反映。出場登録なしは担当可能の確約ではありません。"],
      ["学年","氏名","本人照合",...OB_DUTY_SLOTS.flatMap((s)=>[`${s.time} ${s.label}：出場予定`,`${s.time} ${s.label}：補助員担当`])],
      ...rows.map((row)=>[row.grade,row.name,row.linked?"アプリ名簿":"未照合",...OB_DUTY_SLOTS.flatMap((slot)=>[(slot.note ? "当日確認" : dutyTimeCell(row.entry,slot)==="出場登録なし" || dutyTimeCell(row.entry,slot)==="エントリー未確認" ? "" : "○"),row.linked?dutyRoleText(findDuty(row.id,slot.time,slot.label),roles):""])]),
    ];
    const blob=new Blob(["\uFEFF"+values.map((row)=>row.map(obCsvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");a.href=url;a.download="OB戦_補助員検討表.csv";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="space-y-4"><Card className="space-y-2 p-4"><h2 className="text-headline">補助員の割り当て</h2>
    <p className="text-caption">種目ごとに担当を登録します。○は同時刻に出場するため補助員に割り当てられない枠です。アップ・移動・競技終了時刻を確認して担当を決めてください。空欄でもアップ・移動時間を考慮してください。リレーは当日確認です。</p>
    <p className="text-caption">学年を問わず、エントリーがある現役部員を表示しています。未照合の回答は「本人照合」で確認すると担当を登録できます。</p>
  </Card>
  <div className="flex items-center gap-2"><Input className="min-w-0 flex-1" aria-label="補助員表の氏名・学年で検索" placeholder="氏名・学年で検索" value={search} onChange={(e)=>setSearch(e.target.value)} /><Button size="sm" variant="outline" onClick={download}>CSV出力</Button></div>
  <p className="text-caption">{rows.length}行・種目名をタップすると補助員一覧、担当欄をタップすると登録・編集できます。CSVにも保存済みの担当が出ます。</p>
  <Card className="min-w-0 overflow-hidden"><div className="ob-duty-scroll max-h-[65dvh] overflow-auto" tabIndex={0} role="region" aria-label="部員別の出場予定表">
    <table className="w-full min-w-[1264px] table-fixed lg:min-w-[1072px] border-collapse text-left text-[13px]"><caption className="sr-only">補助員検討用の出場予定</caption>
      <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 w-28 bg-card p-3 lg:w-28 lg:px-2 lg:py-1.5">氏名・学年</th>{OB_DUTY_SLOTS.map((s)=><th key={s.label} scope="col" className="w-24 border-l border-separator lg:w-20"><button type="button" onClick={()=>setSelectedEvent(s)} aria-label={`${s.time} ${s.label}の補助員一覧`} className="min-h-11 w-full p-3 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent lg:px-2 lg:py-1.5"><span className="block tabular-nums">{s.time}</span><span className="font-normal text-accent underline decoration-accent/30 underline-offset-2">{s.label}</span></button></th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id} className="border-t border-separator"><th scope="row" className="sticky left-0 z-10 bg-card p-3 font-normal lg:px-2 lg:py-1"><span className="text-caption lg:mr-1">{row.grade}{!row.linked?"・未照合":""}</span>{row.name}</th>
        {OB_DUTY_SLOTS.map((slot)=>{const value=dutyTimeCell(row.entry,slot);const competing=value!=="出場登録なし"&&value!=="エントリー未確認"&&value!=="当日確認";const duty=row.linked?findDuty(row.id,slot.time,slot.label):undefined;return <td key={slot.label} className={`relative border-l border-separator align-top ${competing?"bg-accent/10":""}`}>
          {row.linked ? <div className="min-h-11 px-2 py-1 lg:min-h-8 lg:px-1.5 lg:py-1">
            <p title={value} className={`lg:truncate ${competing?"font-medium text-accent":"text-muted2"}`}>{competing ? "○" : slot.note ? "当日確認" : ""}</p>
            {duty?.assignment && <p title={dutyRoleText(duty,roles)} className="text-ink truncate">{dutyRoleText(duty,roles,true)}</p>}
            <button type="button" disabled={competing&&!duty?.assignment} aria-label={`${row.name}の${slot.time} ${slot.label}の補助員担当`} className="absolute inset-0 h-full w-full cursor-pointer disabled:cursor-default hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
              onClick={()=>setEditing({profileId:row.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,existing:duty})} />
          </div> : <div className="p-3 lg:px-2 lg:py-1.5"><p title={value} className={`lg:truncate ${competing?"font-medium text-accent":"text-muted2"}`}>{competing ? "○" : slot.note ? "当日確認" : ""}</p><p className="mt-2 lg:mt-0.5 text-caption"><span className="lg:hidden">本人照合後に登録</span><span className="hidden lg:inline">要本人照合</span></p></div>}
        </td>;})}
      </tr>)}</tbody>
    </table>
  </div></Card>{editing && <ObDutyEditor target={editing} roles={roles.filter(r=>r.slot_time===editing.time&&r.event_name===editing.label)} duties={duties} members={members} onClose={()=>setEditing(null)} />}
  {selectedEvent && <ObDutyRoleManager time={selectedEvent.time} event={selectedEvent.label} roles={roles.filter(r=>r.slot_time===selectedEvent.time&&r.event_name===selectedEvent.label)} duties={duties} members={members} onClose={()=>setSelectedEvent(null)}/>}
  </div>;
}
