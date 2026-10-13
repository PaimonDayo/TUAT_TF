import { describe, expect, it } from "vitest";
import { appearancePerformance, competitionEventData, competitionFamilyData, meetBoardGroup, storedMeetPerformance, meetDutyConflict, meetEventCounts, type MeetAppearance, type MeetParticipant, type ManagedMeetEvent } from "./competition-meet";
import {competitionMeetObExport} from "./competition-meet-export";
import { emptyPerformance } from "./meet-operations";
import { obFamilyRows } from "./ob-mixed-operations";
import { obPublishedResultSheets } from "./ob-results-sheet";

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
  expect(exported.entries.map(e=>e.id)).toEqual(["one","two","three"]);expect(exported.entries.map(e=>e.submitted_name)).toEqual(Array(3).fill("合成参加者"));expect(exported.entries[2]).toMatchObject({profile_id:null,qualification_marks:{},canonical_appearance:true});expect(exported.operations[0].data.participants[0]).toMatchObject({entryId:"one",status:"DNS",group:null,trials:a.performance.trials});
 });
 it("exports same-name repeated starts and equal records as separate UUIDs, sheet keys and workbook rows",()=>{
  const ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`);
  const namesake={...person,id:"namesake"};
  const appearances=ids.map((id,index)=>({...appearance(id,index+1),participant_id:index===3?namesake.id:person.id}));
  const meet={participants:[person,namesake],appearances,events:[event],meetKey:"ob-2026"},before=structuredClone(meet);
  const exported=competitionMeetObExport(meet);
  expect(exported.entries.map(e=>e.id)).toEqual(ids);expect(exported.entries.map(e=>e.submitted_name)).toEqual(Array(4).fill(person.name));
  expect(exported.entries.every(e=>e.canonical_appearance)).toBe(true);
  expect(exported.operations[0].data.participants.map(p=>p.entryId)).toEqual(ids);
  const projected=obFamilyRows("100m",exported.entries,exported.operations);
  expect(projected.map(row=>row.id)).toEqual(ids.map(id=>`${event.name}:${id}`));
  expect(projected.map(row=>row.entryId)).toEqual(ids);
  const sheet=obPublishedResultSheets(exported.entries,exported.operations).find(sheet=>sheet.name==="100m")!;
  const lines=sheet.rows.filter(line=>line.includes(person.name));
  expect(lines).toHaveLength(4);expect(lines.map(line=>line[1])).toEqual([1,2,3,4]);
  expect(lines.map(line=>line.slice(2))).toEqual(Array(4).fill(["男子",person.name,"B1","出場","12.34",1]));
  expect(sheet.rows.flat().join(" ")).not.toContain("件目");expect(meet).toEqual(before);
 });
});
