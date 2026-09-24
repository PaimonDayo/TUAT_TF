"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormModal } from "@/components/ui/form-modal";
import type { EntryMember } from "@/lib/entry-identity";
import { entryGrade, normalizeEntryName } from "@/lib/entry-identity";
import type { ObEntry } from "@/lib/ob-entries";
import { OB_DUTY_SLOTS, dutyRows, dutyTimeCell, obCsvCell } from "@/lib/ob-meet";
import type { ObDuty } from "@/lib/ob-duty";
import { ObDutyEditor, type DutyTarget } from "./ObDutyEditor";

export function ObDutyTable({entries,members,duties=[]}:{entries:ObEntry[];members:EntryMember[];duties?:ObDuty[]}) {
  const [search,setSearch]=useState("");
  const [editing,setEditing]=useState<DutyTarget|null>(null);
  const [selectedEvent,setSelectedEvent]=useState<typeof OB_DUTY_SLOTS[number]|null>(null);
  const eventDuties=selectedEvent ? duties.filter((d)=>d.slot_time===selectedEvent.time&&d.event_name===selectedEvent.label&&d.assignment.trim())
    .map((d)=>({duty:d,member:members.find((m)=>m.id===d.profile_id)}))
    .sort((a,b)=>entryGrade(a.member?.grade??null).localeCompare(entryGrade(b.member?.grade??null),"ja") || (a.member?.display_name??"").localeCompare(b.member?.display_name??"","ja")) : [];
  const roleGroups = new Map<string, { label: string; people: typeof eventDuties }>();
  for (const person of eventDuties) {
    const label = person.duty.assignment.trim();
    const key = label.normalize("NFKC").replace(/\s+/gu, " ");
    const group = roleGroups.get(key);
    if (group) group.people.push(person);
    else roleGroups.set(key, { label, people: [person] });
  }
  const findDuty=(profileId:string,time:string,event:string)=>duties.find((d)=>d.profile_id===profileId&&d.slot_time===time&&d.event_name===event);
  const rows=dutyRows(entries,members).filter((row)=>normalizeEntryName(row.name+row.grade).includes(normalizeEntryName(search)));
  function download() {
    const values=[
      ["補助員検討用：開始時刻別の出場登録。終了時刻・アップ・移動は未反映。出場登録なしは担当可能の確約ではありません。"],
      ["学年","氏名","本人照合",...OB_DUTY_SLOTS.flatMap((s)=>[`${s.time} ${s.label}：出場予定`,`${s.time} ${s.label}：補助員担当`])],
      ...rows.map((row)=>[row.grade,row.name,row.linked?"アプリ名簿":"未照合",...OB_DUTY_SLOTS.flatMap((slot)=>[dutyTimeCell(row.entry,slot),row.linked?findDuty(row.id,slot.time,slot.label)?.assignment??"":""])]),
    ];
    const blob=new Blob(["\uFEFF"+values.map((row)=>row.map(obCsvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");a.href=url;a.download="OB戦_補助員検討表.csv";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="space-y-4"><Card className="space-y-2 p-4"><h2 className="text-headline">補助員の割り当て</h2>
    <p className="text-caption">種目ごとに担当を登録します。同じ時刻の他種目への出場予定も表示します。アップ・移動・競技終了時刻を確認して担当を決めてください。「出場登録なし」は空き時間の確定ではありません。リレーは当日確認です。</p>
    <p className="text-caption">学年を問わず、エントリーがある現役部員を表示しています。未照合の回答は「本人照合」で確認すると担当を登録できます。</p>
  </Card>
  <div className="flex items-center gap-2"><Input className="min-w-0 flex-1" aria-label="補助員表の氏名・学年で検索" placeholder="氏名・学年で検索" value={search} onChange={(e)=>setSearch(e.target.value)} /><Button size="sm" variant="outline" onClick={download}>CSV出力</Button></div>
  <p className="text-caption">{rows.length}行・種目名をタップすると補助員一覧、担当欄をタップすると登録・編集できます。CSVにも保存済みの担当が出ます。</p>
  <Card className="min-w-0 overflow-hidden"><div className="ob-duty-scroll max-h-[65dvh] overflow-auto" tabIndex={0} role="region" aria-label="部員別の出場予定表">
    <table className="w-full min-w-[1888px] table-fixed lg:min-w-[1472px] border-collapse text-left text-[13px]"><caption className="sr-only">補助員検討用の出場予定</caption>
      <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 w-40 bg-card p-3 lg:w-32 lg:px-2 lg:py-1.5">氏名・学年</th>{OB_DUTY_SLOTS.map((s)=><th key={s.label} scope="col" className="w-36 border-l border-separator lg:w-28"><button type="button" onClick={()=>setSelectedEvent(s)} aria-label={`${s.time} ${s.label}の補助員一覧`} className="min-h-11 w-full p-3 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent lg:px-2 lg:py-1.5"><span className="block tabular-nums">{s.time}</span><span className="font-normal text-accent underline decoration-accent/30 underline-offset-2">{s.label}</span></button></th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id} className="border-t border-separator"><th scope="row" className="sticky left-0 z-10 bg-card p-3 font-normal lg:px-2 lg:py-1.5"><span className="block text-caption">{row.grade}{!row.linked?"・未照合":""}</span>{row.name}</th>
        {OB_DUTY_SLOTS.map((slot)=>{const value=dutyTimeCell(row.entry,slot);const competing=value!=="出場登録なし"&&value!=="エントリー未確認"&&value!=="当日確認";const duty=row.linked?findDuty(row.id,slot.time,slot.label):undefined;return <td key={slot.label} className={`relative border-l border-separator align-top ${competing?"bg-accent/10":""}`}>
          {row.linked ? <div className="min-h-24 p-3 lg:min-h-14 lg:px-2 lg:py-1.5">
            <p title={value} className={`lg:truncate ${competing?"font-medium text-accent":"text-muted2"}`}>{value}</p>
            <p title={duty?.assignment} className="mt-2 lg:mt-0.5 whitespace-pre-wrap break-words text-ink lg:line-clamp-2">{duty?.assignment || <span className="text-accent"><span className="lg:hidden">＋ 補助員を入れる</span><span className="hidden lg:inline">＋ 担当</span></span>}</p>
            <button type="button" aria-label={`${row.name}の${slot.time} ${slot.label}の補助員担当`} className="absolute inset-0 h-full w-full cursor-pointer hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
              onClick={()=>setEditing({profileId:row.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,existing:duty})} />
          </div> : <div className="p-3 lg:px-2 lg:py-1.5"><p title={value} className={`lg:truncate ${competing?"font-medium text-accent":"text-muted2"}`}>{value}</p><p className="mt-2 lg:mt-0.5 text-caption"><span className="lg:hidden">本人照合後に登録</span><span className="hidden lg:inline">要本人照合</span></p></div>}
        </td>;})}
      </tr>)}</tbody>
    </table>
  </div></Card>{editing && <ObDutyEditor target={editing} onClose={()=>setEditing(null)} />}
  {selectedEvent && <FormModal open title="補助員一覧" autoFocus={false} onOpenChange={(open)=>{if(!open)setSelectedEvent(null);}}>
    <div className="space-y-4"><div><h2 className="text-headline">{selectedEvent.time}　{selectedEvent.label}</h2><p className="text-caption">{eventDuties.length}人</p></div>
      {eventDuties.length ? <div className="divide-y divide-separator">{[...roleGroups.entries()].map(([key,group])=><section key={key} className="py-3"><h3 className="text-headline whitespace-pre-wrap break-words">{group.label}<span className="ml-2 text-caption">{group.people.length}人</span></h3><ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{group.people.map(({duty,member})=><li key={duty.profile_id} className="text-body"><span className="mr-2 text-caption">{entryGrade(member?.grade??null)}</span>{member?.display_name??"名簿情報を確認してください"}</li>)}</ul></section>)}</div> : <p className="text-body text-muted2">補助員はまだ登録されていません。</p>}
    </div>
  </FormModal>}</div>;
}
