"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EntryMember } from "@/lib/entry-identity";
import { normalizeEntryName } from "@/lib/entry-identity";
import type { ObEntry } from "@/lib/ob-entries";
import { OB_DUTY_SLOTS, dutyRows, dutyTimeCell, obCsvCell } from "@/lib/ob-meet";
import type { ObDuty } from "@/lib/ob-duty";
import { ObDutyEditor, type DutyTarget } from "./ObDutyEditor";

export function ObDutyTable({entries,members,duties=[]}:{entries:ObEntry[];members:EntryMember[];duties?:ObDuty[]}) {
  const [search,setSearch]=useState("");
  const [editing,setEditing]=useState<DutyTarget|null>(null);
  const tableScroll = useRef<HTMLDivElement>(null);
  function scrollTable(direction: number) {
    const table = tableScroll.current;
    if (table) table.scrollBy({left: direction * Math.max(144, table.clientWidth - 160), behavior: "smooth"});
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
    <p className="text-caption">エントリーがあるB1・B2を表示しています。未照合の回答は「本人照合」で確認すると担当を登録できます。</p>
  </Card>
  <div className="flex items-center gap-2"><Input className="min-w-0 flex-1" aria-label="補助員表の氏名・学年で検索" placeholder="氏名・学年で検索" value={search} onChange={(e)=>setSearch(e.target.value)} /><Button size="sm" variant="outline" onClick={download}>CSV出力</Button></div>
  <p className="text-caption">{rows.length}行・横にスクロールできます。担当欄をタップして登録・編集できます。CSVにも保存済みの担当が出ます。</p>
  <div className="flex items-center justify-end gap-2" role="group" aria-label="補助員表の横移動">
    <Button size="sm" variant="outline" aria-label="補助員表を左へ移動" onClick={()=>scrollTable(-1)}>← 左へ</Button>
    <Button size="sm" variant="outline" aria-label="補助員表を右へ移動" onClick={()=>scrollTable(1)}>右へ →</Button>
  </div>
  <Card className="min-w-0 overflow-hidden"><div ref={tableScroll} className="ob-duty-scroll max-h-[65dvh] overflow-auto" tabIndex={0} role="region" aria-label="部員別の出場予定表">
    <table className="w-full min-w-[1400px] border-collapse text-left text-[13px]"><caption className="sr-only">補助員検討用の出場予定</caption>
      <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 min-w-40 bg-card p-3">氏名・学年</th>{OB_DUTY_SLOTS.map((s)=><th key={s.label} scope="col" className="min-w-36 border-l border-separator p-3"><span className="block tabular-nums">{s.time}</span><span className="font-normal">{s.label}</span></th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id} className="border-t border-separator"><th scope="row" className="sticky left-0 z-10 bg-card p-3 font-normal"><span className="block text-caption">{row.grade}{!row.linked?"・未照合":""}</span>{row.name}</th>
        {OB_DUTY_SLOTS.map((slot)=>{const value=dutyTimeCell(row.entry,slot);const competing=value!=="出場登録なし"&&value!=="エントリー未確認"&&value!=="当日確認";const duty=row.linked?findDuty(row.id,slot.time,slot.label):undefined;return <td key={slot.label} className={`relative border-l border-separator align-top ${competing?"bg-accent/10":""}`}>
          {row.linked ? <div className="min-h-24 p-3">
            <p className={competing?"font-medium text-accent":"text-muted2"}>{value}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-ink">{duty?.assignment || <span className="text-accent">＋ 補助員を入れる</span>}</p>
            <button type="button" aria-label={`${row.name}の${slot.time} ${slot.label}の補助員担当`} className="absolute inset-0 h-full w-full cursor-pointer hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
              onClick={()=>setEditing({profileId:row.id,name:row.name,grade:row.grade,time:slot.time,label:slot.label,entryText:value,competing,existing:duty})} />
          </div> : <div className="p-3"><p className={competing?"font-medium text-accent":"text-muted2"}>{value}</p><p className="mt-2 text-caption">本人照合後に登録</p></div>}
        </td>;})}
      </tr>)}</tbody>
    </table>
  </div></Card>{editing && <ObDutyEditor target={editing} onClose={()=>setEditing(null)} />}</div>;
}
