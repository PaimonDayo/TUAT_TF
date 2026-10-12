"use client";
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {readCompetitionMeetHistory} from "@/app/(app)/competitions/meet-actions";
type Row={id:string;time:string;actor:string;target:string;action:string};
const labels:Record<string,string>={"participant.save":"参加者を登録・編集","participant.attendance":"大会出欠を変更","participant.delete":"参加者を削除","participant.restore":"参加者を復帰","appearance.add":"出場を追加","appearance.edit":"資格記録を変更","appearance.cancel":"出場を取消","appearance.delete":"出場を削除","appearance.restore":"出場を復帰","event.save":"配置・記録を変更","event.configure":"種目を追加","duty.save":"補助担当を変更","role.save":"補助の役割を変更","role.delete":"補助の役割を削除","party.save":"懇親会の出欠を変更","meet.configure":"大会の担当ロールを変更","sheet.edit":"シートから登録・出場状況を変更",legacy_entry:"以前の登録情報を変更",legacy_operation:"以前の競技情報を変更"};
export function CompetitionMeetHistory({competitionId}:{competitionId:string}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[more,setMore]=useState(true);
 async function load(next=false){if(busy)return;setBusy(true);setMessage("");try{const last=next?rows.at(-1):undefined,result=await readCompetitionMeetHistory(competitionId,last?{id:last.id,time:last.time}:null);setRows(next?[...rows,...result]:result);setMore(result.length===30);setOpen(true);}catch{setMessage("変更履歴を取得できませんでした。もう一度お試しください");}finally{setBusy(false);}}
 return <section className="space-y-2"><Button variant="ghost" disabled={busy} onClick={()=>open?setOpen(false):void load()}>{open?"変更履歴を閉じる":"変更履歴を確認"}</Button>{message&&<p role="alert" className="text-caption">{message}</p>}{open&&<><Button size="sm" variant="outline" disabled={busy} onClick={()=>void load()}>最新の履歴</Button><ul className="divide-y divide-separator">{rows.map(row=><li key={row.id+row.action} className="space-y-1 py-3"><p className="text-body">{row.target}・{labels[row.action]??"登録情報を変更"}</p><p className="text-caption">{new Date(row.time).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}・{row.actor}</p></li>)}</ul>{more&&<Button variant="outline" disabled={busy} onClick={()=>void load(true)}>続きを確認</Button>}</>}</section>;
}
