"use client";
import {useState} from "react";
import {Select} from "@/components/ui/select";
import {Button} from "@/components/ui/button";
import {FormModal,FormModalFooter,FormDraftGuard} from "@/components/ui/form-modal";
import type {CompetitionMeet} from "@/lib/competition-meet";
import type {MeetMutation} from "./CompetitionMeetWorkspace";

export function CompetitionMeetStaffEditor({meet,mutation,onClose}:{meet:CompetitionMeet;mutation:MeetMutation;onClose:()=>void}){
 const [original]=useState(meet.staffRoleId??""),[role,setRole]=useState(original);
 const dirty=role!==original;
 async function save(){if(await mutation.run({action:"meet.configure",staffRoleId:role||null,expectedStaffRoleId:original||null}))onClose();}
 return <FormModal open title="大会の担当ロール" autoFocus={false} onOpenChange={open=>!open&&onClose()}><FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/><div className="space-y-4"><p className="text-body">この大会の参加者・出場・補助担当を管理するロールを選んでください。</p><Select ariaLabel="大会の担当ロール" disabled={mutation.locked} value={role} onValueChange={setRole} options={[{value:"",label:"指定なし"},...(meet.roleOptions??[]).map(r=>({value:r.id,label:r.name}))]}/>{mutation.message&&<p role="status" className="text-caption">{mutation.message}</p>}</div><FormModalFooter><Button className="w-full" disabled={mutation.locked||!dirty} onClick={()=>void save()}>保存する</Button>{mutation.uncertain&&<Button onClick={()=>void mutation.check()}>保存結果を確認</Button>}{mutation.notSaved&&<Button onClick={()=>void mutation.retry()}>同じ操作を再送</Button>}</FormModalFooter></FormModal>;
}
