"use client";

import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Select} from "@/components/ui/select";
import {Sheet,SheetContent} from "@/components/ui/sheet";
import {FormModal,FormModalFooter,FormDraftGuard} from "@/components/ui/form-modal";
import {formatRelayTime,reviewRelayResults,validateRelayResults} from "@/lib/competition-meet-relay";
import type {CompetitionMeet,ManagedMeetEvent,RelayTeamResult} from "@/lib/competition-meet";
import type {MeetMutation} from "./CompetitionMeetWorkspace";

export function CompetitionMeetRelayEditor({event,meet,mutation,onClose}:{event:ManagedMeetEvent;meet:CompetitionMeet;mutation:MeetMutation;onClose:()=>void}) {
  const latest=event.relay_results!;
  const [base,setBase]=useState({teams:latest,revision:event.revision,confirmed:event.confirmed});
  const [teams,setTeams]=useState(latest),[confirmed,setConfirmed]=useState(event.confirmed),[error,setError]=useState("");
  const [reviewing,setReviewing]=useState(false),[choices,setChoices]=useState<Record<string,"own"|"current">>({}),[discard,setDiscard]=useState(false);
  const dirty=JSON.stringify(teams)!==JSON.stringify(base.teams)||confirmed!==base.confirmed;
  if(!dirty&&!mutation.locked&&base.revision!==event.revision){setBase({teams:latest,revision:event.revision,confirmed:event.confirmed});setTeams(latest);setConfirmed(event.confirmed);}
  const changed=base.revision!==event.revision,review=reviewRelayResults(base.teams,teams,latest,choices);
  const recordsChanged=JSON.stringify(teams)!==JSON.stringify(base.teams);
  const mustDiscard=event.confirmed&&recordsChanged;
  function update(lane:number,field:"name"|"time",value:string){setError("");setTeams(before=>before.map(team=>team.lane===lane?{...team,[field]:value}:team));}
  function updateMember(lane:number,runner:number,value:string){setError("");setTeams(before=>before.map(team=>team.lane===lane?{...team,members:team.members.map((name,index)=>index===runner?value:name) as RelayTeamResult["members"]}:team));}
  async function save(){
    const desired:RelayTeamResult[]=teams.map(team=>({...team,name:team.name.trim(),time:formatRelayTime(team.time),members:team.members.map(name=>name.trim()) as RelayTeamResult["members"]}));
    const problem=validateRelayResults(desired,confirmed);if(problem){setError(problem);return;}
    if(await mutation.run({action:"relay.save",event:event.name,revision:base.revision,relayResults:desired,confirmed}))onClose();
  }
  function applyReview(){
    if(mustDiscard&&!discard||!mustDiscard&&review.conflicts.some(conflict=>!choices[conflict.key]))return;
    setTeams(mustDiscard?latest:review.teams);setConfirmed(event.confirmed===base.confirmed?confirmed:event.confirmed);
    setBase({teams:latest,revision:event.revision,confirmed:event.confirmed});setReviewing(false);setChoices({});setDiscard(false);setError("");
  }
  return <FormModal open autoFocus={false} title={event.name} onOpenChange={open=>!open&&onClose()}>
    <FormDraftGuard dirty={dirty} busy={mutation.locked} onSave={save}/>
    <div className="space-y-4">
      <p className="text-caption">各レーンのチーム名、タイム、1走〜4走の氏名を入力してください。</p>
      {changed&&dirty&&<div className="space-y-2"><p className="text-caption">ほかの操作で更新されています。入力は残っています。</p><Button variant="outline" disabled={mutation.locked} onClick={()=>setReviewing(true)}>最新の情報と入力を確認</Button></div>}
      <fieldset disabled={mutation.locked||!meet.permissions.record||event.confirmed} className="space-y-3">
        {teams.map(team=><Card key={team.lane} className="space-y-3 p-3.5"><h3 className="text-body font-semibold">{team.lane}レーン</h3>
          <label className="block space-y-1 text-caption">チーム名<Input aria-label={`${team.lane}レーンのチーム名`} maxLength={100} value={team.name} onChange={e=>update(team.lane,"name",e.target.value)}/></label>
          <label className="block space-y-1 text-caption">タイム（分:秒）<Input aria-label={`${team.lane}レーンのタイム`} placeholder="例: 2:45.67" inputMode="text" value={team.time} onChange={e=>update(team.lane,"time",e.target.value)} onBlur={e=>update(team.lane,"time",formatRelayTime(e.target.value))}/></label>
          <div className="grid grid-cols-2 gap-3">{team.members.map((name,runner)=><label key={runner} className="block space-y-1 text-caption">{runner+1}走<Input aria-label={`${team.lane}レーンの${runner+1}走`} maxLength={100} value={name} onChange={e=>updateMember(team.lane,runner,e.target.value)}/></label>)}</div>
        </Card>)}
      </fieldset>
      {meet.permissions.groups&&<label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" disabled={mutation.locked} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>結果を確定</label>}
      {event.confirmed&&<p className="text-caption">編集する場合は、先に結果の確定を解除して保存してください。</p>}
      {error&&<p role="alert" className="text-body text-danger">{error}</p>}
      {mutation.message&&<p role="status" className="text-caption">{mutation.message}</p>}
      {mutation.uncertain&&<Button disabled={mutation.busy} onClick={()=>void mutation.check()}>保存結果を確認</Button>}
      {mutation.notSaved&&<Button disabled={mutation.busy} onClick={()=>void mutation.retry()}>同じ操作を再送</Button>}
    </div>
    <FormModalFooter><Button className="w-full" disabled={mutation.locked||!dirty||!meet.permissions.record} onClick={()=>void save()}>保存する</Button></FormModalFooter>
    <Sheet open={reviewing} onOpenChange={setReviewing}><SheetContent title="変更の確認"><div className="space-y-4">
      {mustDiscard?<><p className="text-caption">ほかの操作で結果が確定しました。入力を使うには、先に確定を解除してください。</p><label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" checked={discard} onChange={e=>setDiscard(e.target.checked)}/>今回の入力を破棄し、確定済みの結果を使う</label></>:review.conflicts.length?review.conflicts.map(conflict=><div key={conflict.key} className="space-y-2"><p className="text-body">{conflict.lane}レーンの{conflict.label}</p><Select ariaLabel={`${conflict.lane}レーンの${conflict.label}で使う情報`} value={choices[conflict.key]??""} onValueChange={value=>setChoices({...choices,[conflict.key]:value as "own"|"current"})} options={[{value:"current",label:`最新: ${conflict.current||"未入力"}`},{value:"own",label:`入力: ${conflict.own||"未入力"}`}]}/></div>):<p className="text-caption">変更箇所は重複していません。最新の情報と今回の入力を両方保持します。</p>}
      <Button className="w-full" disabled={mustDiscard?!discard:review.conflicts.some(conflict=>!choices[conflict.key])} onClick={applyReview}>確認した内容を使う</Button>
    </div></SheetContent></Sheet>
  </FormModal>;
}
