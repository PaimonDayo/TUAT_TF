"use client";

import {useRef,useState} from "react";
import {FormModal,FormModalFooter,FormDraftGuard} from "@/components/ui/form-modal";
import {Button} from "@/components/ui/button";
import {MeetHeatBoard} from "./MeetHeatBoard";
import {saveObEventOperation} from "@/app/(app)/ob-entries/operations-actions";
import {MeetEvent, type MeetEventData} from "@/lib/meet-operations";
import {obEventRule,reconcileObEvent,type ObEventOperation} from "@/lib/ob-operations";
import {isAlumniEntry,type ObEntry} from "@/lib/ob-entries";
import {MeetHeatPlan} from "@/lib/meet-heat-plan";

export function ObHeatEditor({event,entries,initial,onSaved,onClose}:{event:string;entries:ObEntry[];initial?:ObEventOperation;onSaved:(saved:ObEventOperation)=>void;onClose:()=>void}) {
  const separate=/^(男子|女子)(100m|300m|300mH)$/.test(event);
  const [data,setData]=useState(()=>{
    const reconciled=reconcileObEvent(event,entries,initial?.data);
    return initial?reconciled:new MeetHeatPlan(reconciled,new Set(entries.filter(e=>e.events.includes(event)).map(e=>e.id))).initial(separate);
  });
  const [baseline,setBaseline]=useState(()=>JSON.stringify(reconcileObEvent(event,entries,initial?.data)));
  const [revision,setRevision]=useState(initial?.revision??null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[failed,setFailed]=useState(false);
  const saving=useRef(false),rule=obEventRule(event),dirty=JSON.stringify(data)!==baseline;
  function change(next:MeetEventData){setData(next);setMessage("");}
  async function save(){
    if(saving.current)return;
    const error=new MeetEvent(rule,data).validate();
    if(error){setMessage(error);setFailed(true);return;}
    saving.current=true;setBusy(true);setMessage("");
    try{
      const result=await saveObEventOperation({event,revision,data});
      if(!result.ok||!result.saved){setFailed(true);setMessage(result.message??"保存できませんでした。配置は残っています");return;}
      setRevision(result.saved.revision);setBaseline(JSON.stringify(data));onSaved(result.saved);setFailed(false);setMessage("組み分けを保存しました");
    }catch{setFailed(true);setMessage("通信できませんでした。配置は残っています。接続を確認して再度保存してください");}
    finally{saving.current=false;setBusy(false);}
  }
  return <FormModal open wide autoFocus={false} title={event} onOpenChange={open=>!open&&onClose()}>
    <FormDraftGuard dirty={dirty} busy={busy} onSave={save}/>
    <div className="space-y-4">
      <h2 className="text-headline">組み分け</h2>
      <MeetHeatBoard data={data} entrants={entries.map(e=>({id:e.id,name:e.submitted_name,grade:e.grade,mark:e.qualification_marks[event]??"",alumni:isAlumniEntry(e),eligible:e.events.includes(event)}))} orderLabel={separate?"レーン":rule.discipline==="track"?"出走順":"試技順"} disabled={busy} onChange={change}/>
      {message&&<p role={failed?"alert":"status"} className={`text-body ${failed?"text-danger":"text-accent"}`}>{message}</p>}
    </div>
    <FormModalFooter><Button className="w-full" disabled={busy||(!dirty&&revision!==null)} onClick={()=>void save()}>{busy?"保存中…":"組み分けを保存する"}</Button></FormModalFooter>
  </FormModal>;
}
