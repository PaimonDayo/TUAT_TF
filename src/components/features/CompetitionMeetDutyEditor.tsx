"use client";
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Select} from "@/components/ui/select";
import {FormModal,FormModalFooter,FormDraftGuard} from "@/components/ui/form-modal";
import {availableAppearance,meetDutyEvents,type CompetitionMeet} from "@/lib/competition-meet";
import type {MeetMutation} from "./CompetitionMeetWorkspace";

export function CompetitionMeetDutyEditor({meet,mutation,onClose,roleId}:{meet:CompetitionMeet;mutation:MeetMutation;onClose:()=>void;roleId?:string}) {
 const role=meet.roles.find(r=>r.id===roleId),[event,setEvent]=useState(role?.event_name??""),[time,setTime]=useState(role?.slot_time??""),[person,setPerson]=useState(""),[selected,setSelected]=useState(roleId?[roleId]:[]),[assignment,setAssignment]=useState("");
 const dirty=!!event||!!time||!!person||selected.length>0||!!assignment;
 const availableRoles=meet.roles.filter(r=>r.slot_time===time&&r.event_name===event);
 const conflict=(id:string)=>meet.appearances.some(a=>a.participant_id===id&&meet.events.find(e=>e.name===a.event_name)?.starts_at===time&&(availableAppearance(meet.participants.find(p=>p.id===id),a)&&a.performance.status!=="DNS"||a.performance.status==="DNF"||a.performance.status==="DQ"||a.performance.trials.some(t=>t.status!=="pending"||!!t.mark||!!t.wind)))||meet.duties.some(d=>d.participant_id===id&&d.slot_time===time&&(d.assignment||d.role_ids.length));
 async function save(){if(await mutation.run({action:"duty.save",participantId:person,event,time,roleIds:selected,assignment}))onClose();}
 return <FormModal open title="補助担当を追加" autoFocus={false} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/><fieldset disabled={mutation.locked} className="space-y-4">
  <Select ariaLabel="補助する競技" value={event} onValueChange={value=>{setEvent(value);setTime(meet.events.find(e=>e.family===value)?.starts_at??meet.program?.find(s=>s.label===value)?.time??"");setSelected([]);}} options={meetDutyEvents(meet).map(value=>({value,label:value}))}/>
  <label className="block space-y-2 text-body">担当時刻<Input type="time" value={time} onChange={e=>{setTime(e.target.value);setSelected([]);}}/></label>
  <Select ariaLabel="追加する補助担当者" value={person} onValueChange={setPerson} options={meet.participants.filter(p=>!p.deleted&&!p.absent&&p.grade!=="OB・OG").map(p=>({value:p.id,label:`${p.grade} ${p.name}${conflict(p.id)?"（出場・担当と重複）":""}`,disabled:conflict(p.id)}))}/>
  {availableRoles.map(r=><label key={r.id} className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" checked={selected.includes(r.id)} onChange={e=>setSelected(e.target.checked?[...selected,r.id]:selected.filter(id=>id!==r.id))}/>{r.name}</label>)}
  <label className="block space-y-2 text-body">担当内容（任意）<Input value={assignment} maxLength={200} onChange={e=>setAssignment(e.target.value)}/></label>
 </fieldset>{mutation.message&&<p role="status" className="text-caption">{mutation.message}</p>}<FormModalFooter><Button className="w-full" disabled={mutation.locked||!person||!event||!time||!selected.length&&!assignment.trim()} onClick={()=>void save()}>保存する</Button>{mutation.uncertain&&<Button onClick={()=>void mutation.check()}>保存結果を確認</Button>}{mutation.notSaved&&<Button onClick={()=>void mutation.retry()}>同じ操作を再送</Button>}</FormModalFooter></FormModal>;
}

export function CompetitionMeetRoleEditor({meet,mutation,onClose,roleId}:{meet:CompetitionMeet;mutation:MeetMutation;onClose:()=>void;roleId?:string}) {
 const [original]=useState(meet.roles.find(r=>r.id===roleId)),[name,setName]=useState(original?.name??""),[event,setEvent]=useState(original?.event_name??""),[time,setTime]=useState(original?.slot_time??""),[count,setCount]=useState(String(original?.required_count??1));
 const dirty=name!==(original?.name??"")||event!==(original?.event_name??"")||time!==(original?.slot_time??"")||count!==String(original?.required_count??1);
 async function save(){if(await mutation.run({action:"role.save",id:original?.id,revision:original?.revision,name,event,time,requiredCount:Number(count)}))onClose();}
 return <FormModal open title={original?"補助の役割を編集":"補助の役割を追加"} autoFocus={false} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/><fieldset disabled={mutation.locked} className="space-y-4">
  <Select ariaLabel="役割の競技" disabled={!!original} value={event} onValueChange={value=>{setEvent(value);setTime(meet.events.find(e=>e.family===value)?.starts_at??meet.program?.find(s=>s.label===value)?.time??"");}} options={meetDutyEvents(meet).map(value=>({value,label:value}))}/>
  <label className="block space-y-2 text-body">時刻<Input type="time" disabled={!!original} value={time} onChange={e=>setTime(e.target.value)}/></label>
  <label className="block space-y-2 text-body">役割名<Input maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label>
  <label className="block space-y-2 text-body">必要人数<Input type="number" min={0} max={99} value={count} onChange={e=>setCount(e.target.value)}/></label>
 </fieldset>{mutation.message&&<p role="status" className="text-caption">{mutation.message}</p>}<FormModalFooter><Button className="w-full" disabled={mutation.locked||!dirty||!name.trim()||!event||!time||!Number.isInteger(Number(count))} onClick={()=>void save()}>保存する</Button>{mutation.uncertain&&<Button onClick={()=>void mutation.check()}>保存結果を確認</Button>}{mutation.notSaved&&<Button onClick={()=>void mutation.retry()}>同じ操作を再送</Button>}</FormModalFooter></FormModal>;
}
