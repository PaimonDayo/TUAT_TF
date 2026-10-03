"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import type { MeetEventData, MeetPerformance } from "@/lib/meet-operations";

export type HeatEntrant = {id:string;name:string;grade:string;mark:string;alumni:boolean;eligible:boolean};
export function MeetHeatBoard({data,entrants,orderLabel,disabled,onChange}:{data:MeetEventData;entrants:HeatEntrant[];orderLabel:string;disabled:boolean;onChange:(data:MeetEventData)=>void}) {
  const [selected,setSelected] = useState<string[]>([]);
  const [past,setPast] = useState<MeetEventData[]>([]);
  const [message,setMessage] = useState("");
  const eligible = new Set(entrants.filter(p=>p.eligible).map(p=>p.id));
  const model = new MeetHeatPlan(data,eligible);
  const groups = [...new Set(model.active.flatMap(p=>p.group!==null&&p.order!==null?[p.group]:[]))].sort((a,b)=>a-b);
  const nextGroup = Math.max(0,...data.participants.map(p=>p.group??0))+1;
  const ids = selected.filter(id=>model.active.some(p=>p.entryId===id));
  const person = (id:string)=>entrants.find(p=>p.id===id);
  const inactive = data.participants.filter(p=>!eligible.has(p.entryId)||p.status==="DNS");
  function change(action:()=>MeetEventData) {
    try { const next=action(); if(next!==data){setPast(history=>[...history.slice(-29),data]);onChange(next);}setSelected([]);setMessage(""); }
    catch(error){setMessage((error as Error).message);}
  }
  function row(p:MeetPerformance,selectable=true) {
    const e=person(p.entryId),checked=ids.includes(p.entryId);
    return <button key={p.entryId} type="button" disabled={disabled||!selectable} aria-pressed={selectable?checked:undefined} aria-label={(e?.name??"登録解除済み")+"を選択"} onClick={()=>{setSelected(current=>checked?current.filter(id=>id!==p.entryId):[...current,p.entryId]);setMessage("");}} className={"flex min-h-14 w-full min-w-0 items-center gap-3 border-b border-separator p-3 text-left "+(checked?"bg-accent/10 ring-1 ring-inset ring-accent":"bg-card")}>
      {selectable&&<span aria-hidden className={"flex h-5 w-5 shrink-0 items-center justify-center rounded border "+(checked?"border-accent bg-accent text-white":"border-muted2")}>{checked?"✓":""}</span>}
      <span className="w-6 shrink-0 text-center text-caption tabular-nums">{p.group!==null?p.order:"—"}</span><span className="min-w-0 flex-1"><span className={"block break-words text-body "+(e?.alumni?"text-violet-700":"")}>{e?.name??"登録解除済み"}</span><span className="block text-caption">{e?.grade} {e?.mark&&" · "+e.mark}</span></span>
      {!selectable&&<span className="text-caption">{p.status==="DNS"?"DNS":"出場取消"}</span>}
    </button>;
  }
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><p className="text-caption">人を選び、下のボタンで移します。2人選ぶと入替できます。</p><Button size="sm" variant="ghost" disabled={disabled||!past.length} onClick={()=>{onChange(past.at(-1)!);setPast(past.slice(0,-1));setSelected([]);setMessage("");}}>一つ戻す</Button></div>
    <nav aria-label="組へ移動" className="flex flex-wrap gap-2">{groups.map(group=><Button key={group} variant="outline" size="sm" onClick={()=>document.getElementById("heat-group-"+group)?.scrollIntoView({behavior:"smooth",block:"start"})}>{group}組 · {model.active.filter(p=>p.group===group).length}人</Button>)}{!!model.unassigned.length&&<span className="self-center text-caption">未定 {model.unassigned.length}人</span>}</nav>
    {message&&<p role="alert" className="text-body text-danger">{message}</p>}
    {!!model.unassigned.length&&<section aria-label="未定の出場者" className="overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">未定 · {model.unassigned.length}人</h3>{model.unassigned.map(p=>row(p))}</section>}
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.map(group=><section key={group} id={"heat-group-"+group} aria-label={group+"組"} className="min-w-0 scroll-mt-3 overflow-hidden rounded-xl border border-separator"><h3 className="bg-bg p-3 text-headline">{group}組 <span className="text-caption">{model.active.filter(p=>p.group===group).length}人 · {orderLabel}</span></h3>{model.active.filter(p=>p.group===group&&p.order!==null).sort((a,b)=>a.order!-b.order!).map(p=>row(p))}</section>)}</div>
    {!!inactive.length&&<details className="rounded-xl border border-separator p-3"><summary className="cursor-pointer text-caption">欠場・出場取消 {inactive.length}人</summary><p className="mt-2 text-caption">元の番号と記録を保持しています。</p>{inactive.map(p=>row(p,false))}</details>}
    <FormModalFooter>{ids.length>0&&<div aria-label="選択した人の移動" className="mb-3 space-y-2 border-b border-separator pb-3"><div className="flex items-center justify-between gap-2"><p role="status" className="text-body">{ids.length}人選択中</p><Button variant="ghost" size="sm" disabled={disabled} onClick={()=>setSelected([])}>選択解除</Button></div><div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">{groups.map(group=><Button key={group} variant="outline" size="sm" disabled={disabled} onClick={()=>change(()=>model.move(ids,group))}>{group}組へ</Button>)}<Button variant="outline" size="sm" disabled={disabled} onClick={()=>change(()=>model.move(ids,nextGroup))}>新しい組へ</Button>{ids.some(id=>model.active.find(p=>p.entryId===id)?.group!==null)&&<Button variant="outline" size="sm" disabled={disabled} onClick={()=>change(()=>model.move(ids,null))}>未定へ</Button>}{ids.length===2&&<Button size="sm" disabled={disabled} onClick={()=>change(()=>model.swap(ids))}>2人を入れ替える</Button>}</div></div>}</FormModalFooter>
  </div>;
}
