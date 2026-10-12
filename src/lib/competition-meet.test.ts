import { describe, expect, it } from "vitest";
import { appearancePerformance, competitionEventData, competitionFamilyData, meetBoardGroup, storedMeetPerformance, meetDutyConflict, meetEventCounts, type MeetAppearance, type MeetParticipant, type ManagedMeetEvent } from "./competition-meet";
import {competitionMeetObExport} from "./competition-meet-export";
import { emptyPerformance } from "./meet-operations";

const person: MeetParticipant={id:"person",competition_id:"meet",profile_id:null,name:"合成参加者",grade:"B1",absent:false,deleted:false,revision:0};
const event: ManagedMeetEvent={competition_id:"meet",name:"男子100m",family:"100m",division:"男子",starts_at:"10:00",sort_order:0,discipline:"track",wind:true,capacity:8,confirmed:false,revision:0};
const appearance=(id:string,ordinal:number,state:MeetAppearance["state"]="registered"):MeetAppearance=>({id,competition_id:"meet",participant_id:person.id,event_name:event.name,ordinal,operation_key:id,qualification_mark:null,state,performance:{...emptyPerformance(id),group:1,order:ordinal,trials:[{mark:"12.34",wind:"0",status:"valid"}]},revision:0});
describe("independent competition appearances",()=>{
 it("counts one participant separately from three appearances",()=>{expect(meetEventCounts({participants:[person],appearances:[appearance("one",1),appearance("two",2),appearance("three",3)]},event)).toMatchObject({people:1,appearances:3,dns:0});});
 it("cancels the first appearance without cancelling the second or its own saved trials",()=>{
  const first=appearance("one",1,"cancelled"),second=appearance("two",2);
  const result=competitionEventData({participants:[person],appearances:[first,second]},event);
  expect(result.participants[0]).toMatchObject({entryId:"one",status:"DNS",group:null,order:null,trials:first.performance.trials});
  expect(result.participants[1]).toEqual(second.performance);
 });
 it.each(["cancelled","deleted"] as const)("keeps %s trial history after clearing placement",state=>{const a=appearance("one",1,state);expect(appearancePerformance(person,a)).toMatchObject({status:"DNS",group:null,order:null,trials:a.performance.trials});});
 it.each([{...person,absent:true},{...person,deleted:true},undefined])("unavailable participants do not occupy a slot",p=>{const a=appearance("one",1);expect(appearancePerformance(p,a)).toMatchObject({status:"DNS",group:null,order:null,trials:a.performance.trials});});
 it("keeps DNF and DQ separate from DNS counts",()=>{const a=appearance("one",1),b=appearance("two",2);a.performance.status="DNF";b.performance.status="DQ";expect(meetEventCounts({participants:[person],appearances:[a,b]},event)).toMatchObject({dns:0,dnf:1,dq:1});});
 it("retains an explicit DNS after restoring attendance",()=>{const a=appearance("one",1);a.performance.status="DNS";expect(appearancePerformance(person,a)).toMatchObject({status:"DNS",group:null,order:null});});
 it("round-trips mixed and separate divisions without changing stored numbering",()=>{
  const male=appearance("one",1),female={...appearance("two",2),event_name:"女子100m"};female.performance.heatScope="混合";
  const meet={participants:[person],appearances:[male,female],events:[event,{...event,name:"女子100m",division:"女子" as const}]};
  const data=competitionFamilyData(meet,event);expect(data.participants.map(p=>p.group)).toEqual([1,meetBoardGroup(1,"混合")]);expect(storedMeetPerformance(data.participants[1])).toMatchObject({group:1,order:2,heatScope:"混合"});
 });
 it("keeps recorded duty commitments after cancellation and releases unrecorded cancellation",()=>{
  const a=appearance("one",1,"cancelled"),meet={participants:[person],appearances:[a],events:[event]};expect(meetDutyConflict(meet,person.id,"10:00")).toBe(true);a.performance.trials=[];expect(meetDutyConflict(meet,person.id,"10:00")).toBe(false);
 });
 it("exports all independent appearance IDs and saved withdrawals without account or qualification fields",()=>{
  const a=appearance("one",1,"cancelled"),b=appearance("two",2),c=appearance("three",3);c.qualification_mark="secret qualification";
  const exported=competitionMeetObExport({participants:[person],appearances:[a,b,c],events:[event],meetKey:"another-meet"});
  expect(exported.entries.map(e=>e.id)).toEqual(["one","two","three"]);expect(exported.entries[2]).toMatchObject({submitted_name:"合成参加者（3件目）",profile_id:null,qualification_marks:{},canonical_appearance:true});expect(exported.operations[0].data.participants[0]).toMatchObject({entryId:"one",status:"DNS",group:null,trials:a.performance.trials});
 });
});
