"use client";

import {useState} from "react";
import {ArrowDown, ArrowUp, Undo2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {MeetHeatPlan} from "@/lib/meet-heat-plan";
import type {MeetEventData, MeetPerformance} from "@/lib/meet-operations";

export type HeatEntrant = {id:string; name:string; grade:string; mark:string; alumni:boolean; eligible:boolean};

/** Touch and keyboard share the same selection → destination operations. */
export function MeetHeatBoard({data, entrants, orderLabel, disabled, onChange}:{data:MeetEventData; entrants:HeatEntrant[]; orderLabel:string; disabled:boolean; onChange:(data:MeetEventData)=>void}) {
  const [capacity,setCapacity]=useState(String(Math.max(...data.participants.map(p=>p.order??0),0)||8));
  const [extraGroups,setExtraGroups]=useState<number[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [past,setPast]=useState<MeetEventData[]>([]);
  const [search,setSearch]=useState("");
  const [message,setMessage]=useState("");
  const eligible=new Set(entrants.filter(e=>e.eligible).map(e=>e.id));
  const model=new MeetHeatPlan(data,eligible);
  const size=Number(capacity),validSize=Number.isInteger(size)&&size>=1&&size<=99;
  const person=(id:string)=>entrants.find(e=>e.id===id);
  const groups=[...new Set([1,...data.participants.flatMap(p=>p.group?[p.group]:[]),...extraGroups])].sort((a,b)=>a-b);
  const inactive=data.participants.filter(p=>!eligible.has(p.entryId)||p.status==="DNS");
  const unassigned=model.unassigned.filter(p=>`${person(p.entryId)?.name??""}${person(p.entryId)?.grade??""}`.replaceAll(/\s/g,"").toLowerCase().includes(search.replaceAll(/\s/g,"").toLowerCase()));
  const selectedIds=data.participants.filter(p=>selected.includes(p.entryId)).sort((a,b)=>(a.group??100)-(b.group??100)||(a.order??100)-(b.order??100)).map(p=>p.entryId);
  function change(action:()=>MeetEventData) {
    try {
      const next=action();
      if(next!==data){setPast(history=>[...history.slice(-29),data]);onChange(next);}
      setSelected([]);setMessage("");
    } catch(error) {setMessage((error as Error).message);}
  }
  function toggle(id:string) {setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);setMessage("");}
  function identity(p:MeetPerformance) {
    const e=person(p.entryId);
    return <span className="min-w-0 flex-1"><span title={e?.name??"登録解除済み"} className={`block truncate text-body ${e?.alumni?"text-violet-700":""}`}>{e?.name??"登録解除済み"}</span><span className="block truncate text-caption" title={e?.mark}><span className={e?.alumni?"text-violet-700":""}>{e?.grade??"登録解除"}</span> · {e?.mark||"資格記録なし"}</span></span>;
  }
  function selectPerson(p:MeetPerformance) {
    return <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2 py-2"><input aria-label={`${person(p.entryId)?.name??"登録解除済み"}を選択`} type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={selected.includes(p.entryId)} onChange={()=>toggle(p.entryId)}/>{identity(p)}</label>;
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-caption">1組の人数<Input aria-label="1組の人数" className="mt-1 w-20" type="number" min={1} max={99} value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
      <Button variant="outline" disabled={!validSize||!model.unassigned.length} onClick={()=>change(()=>model.fill(size))}>未配置をまとめて割り当て</Button>
      <Button variant="ghost" disabled={!past.length} onClick={()=>{const previous=past.at(-1);if(previous){onChange(previous);setPast(past.slice(0,-1));setSelected([]);setMessage("");}}}><Undo2 size={16}/>一つ戻す</Button>
    </div>
    <p className="text-caption">{model.active.length-model.unassigned.length} / {model.active.length}人配置済み · 未配置 {model.unassigned.length}人</p>
    {!!model.unassigned.length&&<p className="text-micro text-muted2">まとめて割り当てると、未配置の人を名簿順に空き枠へ入れます。資格記録を見ながら調整できます。</p>}
    <div className="sticky top-0 z-10 rounded-xl border border-separator bg-card p-3 shadow-sm" aria-live="polite">
      {selected.length?<div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-body">{selected.length}人選択中</span><Button size="sm" variant="outline" onClick={()=>change(()=>model.unassign(selected))}>未配置へ戻す</Button><Button size="sm" variant="ghost" onClick={()=>{setSelected([]);setMessage("");}}>選択解除</Button><p className="w-full text-caption">移動先の「この組に入れる」を押してください。1人選ぶと番号の指定・入れ替えもできます。</p></div>:<p className="text-caption">人を選んで、移動先の組を押してください。複数人をまとめて移せます。</p>}
    </div>
    {message&&<p role="alert" className="text-body text-danger">{message}</p>}
    {!!model.unassigned.length&&<section aria-label="未配置の出場者" className="rounded-xl border border-separator bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-headline">未配置 <span className="text-caption">{model.unassigned.length}人</span></h2><Button size="sm" variant="ghost" disabled={!unassigned.length} onClick={()=>setSelected(ids=>[...new Set([...ids,...unassigned.map(p=>p.entryId)])])}>表示中を選択</Button></div>
      <Input aria-label="未配置の氏名で検索" placeholder="氏名で検索" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="mt-2 grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto md:grid-cols-2">{unassigned.map(p=><div key={p.entryId} className="min-w-0 border-b border-separator">{selectPerson(p)}</div>)}</div>
      {!unassigned.length&&<p className="py-3 text-caption">{model.unassigned.length?"検索に一致する人はいません":"全員を配置しました"}</p>}
    </section>}
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map(group=>{
        const placed=data.participants.filter(p=>p.group===group&&p.order!==null&&p.status!=="DNS");
        const count=Math.max(validSize?size:8,...placed.map(p=>p.order!));
        const free=count-new Set(placed.map(p=>p.order)).size;
        return <section key={group} aria-label={`${group}組`} className="min-w-0 overflow-hidden rounded-xl border border-separator bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-separator p-3"><div><h2 className="text-headline">{group}組</h2><p className="text-caption">{placed.length}人 · 空き {free}</p></div><Button size="sm" variant="outline" disabled={!selected.length||!validSize} onClick={()=>change(()=>model.assign(selectedIds,group,count))}>この組に入れる</Button></div>
          <p className="border-b border-separator px-3 py-1 text-micro text-muted2">{orderLabel} · 氏名／資格記録</p>
          <div className="divide-y divide-separator">{Array.from({length:count},(_,index)=>{
            const order=index+1,p=placed.find(p=>p.order===order),active=p&&eligible.has(p.entryId),one=selected.length===1?selected[0]:null;
            return <div key={order} className={`flex min-h-14 min-w-0 items-center gap-2 px-2 ${p&&selected.includes(p.entryId)?"bg-accent/5":""}`}>
              <span className="w-6 shrink-0 text-center text-caption tabular-nums" title={orderLabel}>{order}</span>
              {p?(active?selectPerson(p):<div className="flex min-w-0 flex-1 items-center gap-2 py-2">{identity(p)}<span className="text-micro text-danger">出場取消</span></div>):<span className="min-w-0 flex-1 text-caption text-muted2">空き</span>}
              {one&&one!==p?.entryId?<Button size="sm" variant="outline" disabled={!!p&&!active} aria-label={`${person(one)?.name}を${group}組${order}番へ${p?"・入れ替え":"配置"}`} onClick={()=>change(()=>model.place(one,group,order))}>{p?"入替":"ここへ"}</Button>:p&&active?<div className="flex shrink-0"><Button size="sm" variant="ghost" className="min-h-11 min-w-9 px-1" aria-label={`${person(p.entryId)?.name}を一つ前へ`} disabled={order===1||selected.length>0} onClick={()=>change(()=>model.place(p.entryId,group,order-1))}><ArrowUp size={16}/></Button><Button size="sm" variant="ghost" className="min-h-11 min-w-9 px-1" aria-label={`${person(p.entryId)?.name}を一つ後へ`} disabled={order===count||selected.length>0} onClick={()=>change(()=>model.place(p.entryId,group,order+1))}><ArrowDown size={16}/></Button></div>:null}
            </div>;
          })}</div>
        </section>;
      })}
    </div>
    <Button variant="outline" disabled={Math.max(...groups)>=99} onClick={()=>setExtraGroups([...extraGroups,Math.max(...groups)+1])}>組を追加</Button>
    <p className="text-micro text-muted2">空の組は保存されません。人数を減らしても配置済みの番号は残ります。</p>
    {!!inactive.length&&<section className="space-y-2"><h2 className="text-headline">欠場・出場取消</h2><p className="text-caption">入力済みの記録は保持しています。出場状況は試技記録で変更できます。</p>{inactive.map(p=><div key={p.entryId} className="flex min-w-0 items-center gap-2 rounded-xl border border-separator p-3">{identity(p)}<span className="text-caption">{p.status==="DNS"?"欠場":"取消"}</span>{(p.group!==null||p.order!==null)&&<Button size="sm" variant="outline" onClick={()=>change(()=>model.unassign([p.entryId]))}>配置を外す</Button>}</div>)}</section>}
  </fieldset>;
}
