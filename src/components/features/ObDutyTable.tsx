"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EntryMember } from "@/lib/entry-identity";
import { normalizeEntryName } from "@/lib/entry-identity";
import type { ObEntry } from "@/lib/ob-entries";
import { OB_DUTY_SLOTS, dutyRows, dutyCell, obCsvCell } from "@/lib/ob-meet";
import type { ObDuty } from "@/lib/ob-duty";
import { ObDutyEditor, type DutyTarget } from "./ObDutyEditor";

export function ObDutyTable({entries,members,duties=[]}:{entries:ObEntry[];members:EntryMember[];duties?:ObDuty[]}) {
  const [search,setSearch]=useState("");
  const [editing,setEditing]=useState<DutyTarget|null>(null);
  const findDuty=(profileId:string,time:string)=>duties.find((d)=>d.profile_id===profileId&&d.slot_time===time);
  const rows=dutyRows(entries,members).filter((row)=>normalizeEntryName(row.name+row.grade).includes(normalizeEntryName(search)));
  function download() {
    const values=[
      ["補助員検討用：開始時刻別の出場登録。終了時刻・アップ・移動は未反映。出場登録なしは担当可能の確約ではありません。"],
      ["学年","氏名","本人照合",...OB_DUTY_SLOTS.flatMap((s)=>[`${s.time} ${s.label}：出場予定`,`${s.time}：補助員担当`])],
      ...rows.map((row)=>[row.grade,row.name,row.linked?"アプリ名簿":"未照合",...OB_DUTY_SLOTS.flatMap((slot)=>[dutyCell(row.entry,slot),row.linked?findDuty(row.id,slot.time)?.assignment??"":""])]),
    ];
    const blob=new Blob(["\uFEFF"+values.map((row)=>row.map(obCsvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");a.href=url;a.download="OB戦_補助員検討表.csv";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="space-y-4"><Card className="space-y-2 p-4"><h2 className="text-headline">補助員の割り当て</h2>
    <p className="text-caption">開始時刻ごとの出場登録です。アップ・移動・競技終了時刻を確認して担当を決めてください。「出場登録なし」は空き時間の確定ではありません。リレーは当日確認です。</p>
    <p className="text-caption">「エントリー未確認」は、その部員に紐付いた競技エントリーがない状態です。未照合の回答は別行に表示するので、「本人照合」で確認してください。</p>
  </Card>
  <div className="flex items-center gap-2"><Input className="min-w-0 flex-1" aria-label="補助員表の氏名・学年で検索" placeholder="氏名・学年で検索" value={search} onChange={(e)=>setSearch(e.target.value)} /><Button size="sm" variant="outline" onClick={download}>CSV出力</Button></div>
  <p className="text-caption">{rows.length}行・横にスクロールできます。担当欄をタップして登録・編集できます。CSVにも保存済みの担当が出ます。</p>
  <Card className="overflow-hidden"><div className="max-h-[65dvh] overflow-auto" tabIndex={0} role="region" aria-label="部員別の出場予定表">
    <table className="w-full min-w-[1400px] border-collapse text-left text-[13px]"><caption className="sr-only">補助員検討用の出場予定</caption>
      <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 min-w-40 bg-card p-3">氏名・学年</th>{OB_DUTY_SLOTS.map((s)=><th key={s.time} scope="col" className="min-w-36 border-l border-separator p-3"><span className="block tabular-nums">{s.time}</span><span className="font-normal">{s.label}</span></th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id} className="border-t border-separator"><th scope="row" className="sticky left-0 z-10 bg-card p-3 font-normal"><span className="block text-caption">{row.grade}{!row.linked?"・未照合":""}</span>{row.name}</th>
        {OB_DUTY_SLOTS.map((slot)=>{const value=dutyCell(row.entry,slot);const competing=!!row.entry?.events.some((e)=>slot.events.includes(e.slice(2)));const duty=row.linked?findDuty(row.id,slot.time):undefined;return <td key={slot.time} className={`border-l border-separator p-3 align-top ${competing?"bg-accent/10":""}`}>
          <p className={competing?"font-medium text-accent":"text-muted2"}>{value}</p>
          {row.linked ? <button type="button" aria-label={`${row.name}の${slot.time}の補助員担当`} className="mt-2 min-h-11 w-full whitespace-pre-wrap break-words rounded-lg border border-separator bg-card px-2 py-2 text-left text-ink pressable"
            onClick={()=>setEditing({profileId:row.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,existing:duty})}>{duty?.assignment || <span className="text-accent">＋ 担当を追加</span>}</button> : <p className="mt-2 text-caption">本人照合後に登録</p>}
        </td>;})}
      </tr>)}</tbody>
    </table>
  </div></Card>{editing && <ObDutyEditor target={editing} onClose={()=>setEditing(null)} />}</div>;
}
