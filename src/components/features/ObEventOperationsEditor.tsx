"use client";

import { useRef, useState } from "react";
import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { saveObEventOperation } from "@/app/(app)/ob-entries/operations-actions";
import { MeetEvent, emptyTrial, type MeetEventData, type MeetPerformance } from "@/lib/meet-operations";
import { obEventRule, reconcileObEvent, type ObEventOperation } from "@/lib/ob-operations";
import { isAlumniEntry, type ObEntry } from "@/lib/ob-entries";

export function ObEventOperationsEditor({ event, entries, initial, mode, onSaved, onClose }: { event: string; entries: ObEntry[]; initial?: ObEventOperation; mode: "groups" | "records"; onSaved: (saved: ObEventOperation) => void; onClose: () => void }) {
  const [data, setData] = useState<MeetEventData>(() => reconcileObEvent(event, entries, initial?.data));
  const [baseline, setBaseline] = useState(() => JSON.stringify(reconcileObEvent(event, entries, initial?.data)));
  const [revision, setRevision] = useState(initial?.revision ?? null);
  const [view, setView] = useState(mode);
  const [capacity, setCapacity] = useState("8");
  const [personId, setPersonId] = useState(data.participants[0]?.entryId ?? "");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const rule = obEventRule(event), model = new MeetEvent(rule, data);
  const person = data.participants.find(p => p.entryId === personId);
  const dirty = JSON.stringify(data) !== baseline;
  const entryOf = (id: string) => entries.find(e => e.id === id);
  function update(id: string, patch: Partial<MeetPerformance>) {
    setMessage(""); setData(previous => ({ ...previous, confirmed: false, participants: previous.participants.map(p => p.entryId === id ? { ...p, ...patch } : p) }));
  }
  async function save() {
    if (saving.current) return;
    const error = model.validate();
    if (error) { setFailed(true); setMessage(error); return; }
    saving.current = true; setBusy(true); setMessage("");
    try {
      const result = await saveObEventOperation({ event, revision, data });
      if (!result.ok || !result.saved) { setFailed(true); setMessage(result.message ?? "保存できませんでした。入力は残っています"); return; }
      setRevision(result.saved.revision); setBaseline(JSON.stringify(data)); onSaved(result.saved); setFailed(false); setMessage("保存しました");
    } catch { setFailed(true); setMessage("通信できませんでした。入力は残っています。接続を確認して再度保存してください"); }
    finally { saving.current = false; setBusy(false); }
  }
  const trialCount = rule.discipline === "track" ? 1 : rule.discipline === "distance" ? 6 : Math.max(3, person?.trials.length ?? 0);
  const ordered = [...data.participants].sort((a,b)=>(a.group??100)-(b.group??100)||(a.order??100)-(b.order??100));
  return <FormModal open autoFocus={false} title={event} onOpenChange={open => !open && onClose()}>
    <FormDraftGuard dirty={dirty} busy={busy} onSave={save}/>
    <div className="space-y-4">
      <p className="text-caption">システム限定・{data.confirmed?"確認済み":"速報／調整中"} · {data.participants.length}人</p>
      <SegmentedControl items={[{key:"groups",label:"組み分け"},{key:"records",label:"試技記録"}]} value={view} onChange={value=>setView(value)}/>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      {view === "groups" ? <>
        <div className="flex flex-wrap items-end gap-2"><label className="text-caption">1組の人数<Input aria-label="1組の人数" className="mt-1 w-20" type="number" min={1} max={99} value={capacity} onChange={e=>setCapacity(e.target.value)}/></label><Button variant="outline" onClick={()=>{try{setData(model.seed(Number(capacity)));setMessage("");}catch(e){setFailed(true);setMessage((e as Error).message);}}}>未配置だけ仮配置</Button></div>
        <p className="text-micro text-muted2">現在の名簿順に配置します。資格記録による振り分けは行いません。入力済みの組・順番・試技は保持します。</p>
        <Card className="overflow-hidden"><div className="ob-duty-scroll overflow-auto"><table data-ui-table className="w-full min-w-[330px] table-fixed text-left text-body"><thead><tr className="border-b border-separator"><th className="w-[38%] p-2">氏名</th><th className="w-[22%] p-2">組</th><th className="p-2">{rule.discipline==="track"?"レーン／順":"試技順"}</th></tr></thead><tbody>
        {data.participants.map(p=>{const entry=entryOf(p.entryId);return <tr key={p.entryId} className="border-b border-separator last:border-0"><th scope="row" className={`p-2 font-normal ${entry&&isAlumniEntry(entry)?"text-violet-700":""}`}><span className="block truncate text-micro">{entry?.grade??"登録解除"}</span><span className="block truncate" title={entry?.submitted_name}>{entry?.submitted_name??"登録解除済み"}</span>{entry&&!entry.events.includes(event)&&<span className="text-micro text-danger">出場取消</span>}</th><td className="p-1"><Input type="number" min={1} max={99} aria-label={`${entry?.submitted_name}の組`} value={p.group??""} onChange={e=>update(p.entryId,{group:e.target.value===""?null:Number(e.target.value)})}/></td><td className="p-1"><Input type="number" min={1} max={99} aria-label={`${entry?.submitted_name}のレーン・試技順`} value={p.order??""} onChange={e=>update(p.entryId,{order:e.target.value===""?null:Number(e.target.value)})}/></td></tr>})}
        </tbody></table></div></Card>
      </> : <>
        <Select ariaLabel="記録を入力する出場者" value={personId} onValueChange={setPersonId} options={ordered.map(p=>({value:p.entryId,label:`${p.group??"—"}組 ${p.order??"—"}番 · ${entryOf(p.entryId)?.grade??""} ${entryOf(p.entryId)?.submitted_name??"登録解除済み"}`}))}/>
        {person&&<>
          <Select ariaLabel="出場状況" value={person.status} onValueChange={status=>update(person.entryId,{status:status as MeetPerformance["status"]})} options={[{value:"entered",label:"出場"},{value:"DNS",label:"欠場（DNS）"},{value:"DNF",label:"途中棄権（DNF）"},{value:"DQ",label:"失格（DQ）"}]}/>
          <p className="text-headline">{rule.discipline==="track"?"記録":"ベスト"}：{model.best(person)}</p>
          <p className="text-micro text-muted2">{rule.discipline==="height"?"高さをmで入力し、同じ高さも1試技ずつ○・×・−を記録します。順位は審判確認後に決定してください。":rule.discipline==="track"?"秒または分:秒（例 12.34、4:12.34）で入力してください。":"記録はm単位。未実施の試技は空欄のままにしてください。"}</p>
          <div className="space-y-2">{Array.from({length:trialCount},(_,index)=>{const trial=person.trials[index]??emptyTrial();const change=(patch:Partial<typeof trial>)=>{const trials=Array.from({length:Math.max(person.trials.length,index+1)},(_,i)=>person.trials[i]??emptyTrial());trials[index]={...trial,...patch};update(person.entryId,{trials});};return <Card key={`${personId}:${index}`} className="space-y-2 p-3"><div className="flex items-center gap-3"><span className="w-10 shrink-0 text-caption">{rule.discipline==="track"?"結果":`${index+1}回目`}</span><div className="min-w-0 flex-1"><Select ariaLabel={`${index+1}回目の結果`} value={trial.status} onValueChange={status=>change({status:status as typeof trial.status,...(status==="pending"?{mark:"",wind:""}:status!=="valid"&&rule.discipline!=="height"?{mark:"",wind:""}:{})})} options={[{value:"pending",label:"未記録"},{value:"valid",label:rule.discipline==="height"?"○ 成功":"記録あり"},...(rule.discipline==="track"?[]:[{value:"foul",label:"× 失敗"},{value:"pass",label:"− パス"}])]}/></div></div><div className={`grid gap-2 ${rule.wind?"grid-cols-2":"grid-cols-1"}`}><label className="text-caption">{rule.discipline==="track"?"タイム":rule.discipline==="height"?"高さ（m）":"記録（m）"}<Input aria-label={`${index+1}回目の記録`} inputMode={rule.discipline==="track"?"text":"decimal"} placeholder={rule.discipline==="track"?"4:12.34":"0.00"} value={trial.mark} disabled={person.status!=="entered"||trial.status!=="valid"&&trial.status!=="pending"&&rule.discipline!=="height"} onChange={e=>change({mark:e.target.value,...(trial.status==="pending"&&e.target.value?{status:"valid" as const}:{})})}/></label>{rule.wind&&<label className="text-caption">風速（m/s）<Input aria-label={`${index+1}回目の風速`} placeholder="+1.2 / -0.5" value={trial.wind} disabled={person.status!=="entered"||trial.status!=="valid"} onChange={e=>change({wind:e.target.value})}/></label>}</div></Card>})}</div>
          {rule.discipline==="height"&&trialCount<30&&<Button variant="outline" onClick={()=>update(person.entryId,{trials:[...Array.from({length:trialCount},(_,i)=>person.trials[i]??emptyTrial()),emptyTrial()]})}>次の試技を追加</Button>}
        </>}
      </>}
      <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" checked={data.confirmed} onChange={e=>setData({...data,confirmed:e.target.checked})}/>結果を確認済みにする</label>
      </fieldset>
      {message&&<p role={failed?"alert":"status"} className={`text-body ${failed?"text-danger":"text-accent"}`}>{message}</p>}
    </div>
    <FormModalFooter><Button className="w-full" disabled={busy||(!dirty&&revision!==null)} onClick={()=>void save()}>{busy?"保存中…":"変更を保存する"}</Button></FormModalFooter>
  </FormModal>;
}
