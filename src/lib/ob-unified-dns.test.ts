import { expect, it } from "vitest";
import { emptyPerformance } from "./meet-operations";
import { MeetHeatPlan } from "./meet-heat-plan";
import { obEventParticipants, effectiveObParticipation, obEventRule } from "./ob-operations";
import { obResultRanks } from "./ob-result-ranking";
import { projectObMixedEvent, splitObMixedEvent, obMixedLimits } from "./ob-mixed-operations";
import { obSheetStatusLabel, OB_SHEET_STATUSES } from "./ob-sheet-status";
import type { ObEntry } from "./ob-entries";

const event = "男子100m";
const entry: ObEntry = {id:"old",meet_key:"ob-2026",submitted_name:"合成元参加者",grade:"B1",profile_id:null,events:[event,event],qualification_marks:{},revision:0,imported_at:""};
const replacement={...entry,id:"next",submitted_name:"合成代替参加者",events:[event]};
const performance={...emptyPerformance(entry.id),group:1,order:1,heatScope:"混合" as const,trials:[{mark:"12.34",status:"valid" as const,wind:"0"}]};

it.each(["absence","cancellation","missing","explicit"])("unifies %s as DNS, frees its lane and retains trials before another entrant is placed",reason=>{
 const old=reason==="missing"?[]:[reason==="absence"?{...entry,absent:true}:reason==="cancellation"?{...entry,events:[]}:entry];
 const saved={confirmed:false,participants:[reason==="explicit"?{...performance,status:"DNS" as const}:performance,emptyPerformance(replacement.id)]};
 const operation={meet_key:"ob-2026",event_name:event,revision:3,updated_at:"",data:saved};
 const snapshot=JSON.stringify([old,saved]);
 const row=obEventParticipants(event,[...old,replacement],saved)[0];
 expect(row.state).toMatchObject({status:"DNS",label:"DNS",canParticipate:false,recorded:true});
 expect(row.performance).toEqual({...performance,group:null,order:null,heatScope:undefined,status:"DNS"});
 expect(row.performance).not.toHaveProperty("heatScope");
 expect(row.performance.trials).toBe(performance.trials);
 expect(obResultRanks(obEventRule(event), [row.performance]).size).toBe(0);
 const projection=projectObMixedEvent(event,[...old,replacement],[operation]);
 const eligible=new Set(projection.entrants.filter(p=>p.eligible&&!p.absent).map(p=>p.id));
 const moved=new MeetHeatPlan(projection.data,eligible,obMixedLimits).move([event+":"+replacement.id],199,1);
 const savedNext=splitObMixedEvent(projection,moved)[0].data;
 expect(savedNext.participants[0]).toMatchObject({status:"DNS",group:null,order:null,trials:performance.trials});
 expect(savedNext.participants[1]).toMatchObject({status:"entered",heatScope:"混合",group:1,order:1});
 expect(JSON.stringify([old,saved])).toBe(snapshot);
});

it("releases only a cancelled second appearance while preserving the first appearance",()=>{
 const second={...performance,entryId:"old:2",order:2};
 const rows=obEventParticipants(event,[{...entry,events:[event]}],{confirmed:true,participants:[performance,second]});
 expect(rows[0].performance).toBe(performance);
 expect(rows[1].performance).toMatchObject({status:"DNS",group:null,order:null,trials:second.trials});
 expect(effectiveObParticipation(event,{...entry,events:[event]},second).status).toBe("DNS");
});

it.each(["DNS", "DNS（欠場）", "欠席", "欠場", "出場取消", "登録解除"])("accepts %s from existing private sheets as the same canonical DNS",label=>{
 const key=obSheetStatusLabel(label) as keyof typeof OB_SHEET_STATUSES;
 expect(OB_SHEET_STATUSES[key]).toBe("DNS");
});
