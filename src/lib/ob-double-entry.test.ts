import { expect, it } from "vitest";
import { emptyPerformance } from "./meet-operations";
import { MeetHeatPlan } from "./meet-heat-plan";
import { obEventParticipants, obDutyCompetitionEvents } from "./ob-operations";
import { projectObMixedEvent, splitObMixedEvent, obFamilyRows } from "./ob-mixed-operations";
import { obSheetEditSource } from "./ob-sheet-edits";
import { signObSheetTarget, readObSheetTarget } from "./ob-sheet-status";
import { obResultSheet } from "./ob-results-sheet";
import type { ObEntry } from "./ob-entries";
const event = "男子100m", id = "00000000-0000-4000-8000-000000000001";
const entry: ObEntry = {id, meet_key:"ob-2026", submitted_name:"合成参加者",grade:"B1",profile_id:null,events:[event,event],qualification_marks:{[event]:"11.5"},revision:1,imported_at:""};
const first = {...emptyPerformance(id), group:1,order:1,trials:[{mark:"11.80",wind:"",status:"valid" as const}]};
const second = {...emptyPerformance(id+":2"),group:2,order:3,status:"DNS" as const};
const operation = {meet_key:"ob-2026",event_name:event,revision:2,updated_at:"",data:{confirmed:false,participants:[first,second]}};
it("adds the second blank appearance without rewriting the first result",()=>{
 const rows=obEventParticipants(event,[entry],{confirmed:false,participants:[first]});
 expect(rows.map(row=>row.entryId)).toEqual([id,id+":2"]); expect(rows[0].performance).toBe(first);
 expect(rows[1].performance).toEqual(emptyPerformance(id+":2")); expect(rows.every(row=>row.state.registered)).toBe(true);
});
it("withdraws only the second appearance while retaining both saved placements and results",()=>{
 const rows=obEventParticipants(event,[{...entry,events:[event]}],operation.data);
 expect(rows[0].state.registered).toBe(true); expect(rows[1].state.registered).toBe(false); expect(rows[1].performance).toBe(second);
 const recorded={...second,status:"entered" as const,trials:first.trials};
 expect(obDutyCompetitionEvents({...entry,events:[]},[{...operation,data:{confirmed:false,participants:[recorded]}}])).toEqual([event]);
});
it("moves one appearance into a recorded heat without changing either result or DNS",()=>{
 const projection=projectObMixedEvent("100m",[entry],[{...operation,data:{confirmed:false,participants:[first,emptyPerformance(id+":2")]}}]);
 const moved=new MeetHeatPlan(projection.data,new Set(projection.entrants.map(row=>row.id))).move([event+":"+id+":2"],1,8);
 const saved=splitObMixedEvent(projection,moved).find(row=>row.event===event)!;
 expect(saved.data.participants[0]).toBe(first); expect(saved.data.participants[1]).toMatchObject({entryId:id+":2",group:1,order:2,trials:[]});
});
it("keeps two independent public rows and export results with labels",()=>{
 const rows=obFamilyRows("100m",[entry],[operation]); expect(rows).toHaveLength(2); expect(rows.map(row=>row.entry?.id)).toEqual([id,id]);
 const sheet=obResultSheet("100m",[entry],[{...operation,data:{confirmed:false,participants:[first,{...second,status:"entered",trials:[{mark:"12.10",wind:"",status:"valid"}]}]}}]); expect(JSON.stringify(sheet)).toContain("合成参加者（1件目）"); expect(JSON.stringify(sheet)).toContain("合成参加者（2件目）"); expect(JSON.stringify(sheet)).toContain("11.80");
});
it("signs distinct private sheet keys and targets for the second appearance",()=>{
 const source=obSheetEditSource([entry],[operation],"test-secret"); expect(source.editSheet.rows[1][0]).not.toBe(source.editSheet.rows[2][0]);
 const target={entryId:id+":2",event,entryRevision:1,operationRevision:2};expect(readObSheetTarget(signObSheetTarget(target,"test-secret"),"test-secret")).toEqual(target);
 expect(readObSheetTarget(signObSheetTarget({...target,entryId:id+":3"},"test-secret"),"test-secret")).toBeNull();
});
