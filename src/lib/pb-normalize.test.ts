import { expect, it } from "vitest";
import { planPbNormalization, type LegacyPb } from "./pb-normalize";
const row: LegacyPb = {id:"a",user_id:"u",event_name:"１５００",record:"4:02.35",is_pb:true,is_ub:false,result_status:"ok",value_cs:null,value_cm:null,value_points:null};
const events = [{name:"1500m",measure_type:"time" as const},{name:"走幅跳",measure_type:"distance" as const}];
it("normalizes only approved fields and keeps the source intact", () => {
  const original = structuredClone(row);
  expect(planPbNormalization([row],events).patches).toEqual([{id:"a",changes:{event_name:"1500m",value_cs:24235}}]);
  expect(row).toEqual(original);
});
it("does not decide between competing best flags after a rename", () => {
  const result = planPbNormalization([row,{...row,id:"b",event_name:"1500m"}],events);
  expect(result.patches.some(p => p.id === "a")).toBe(false);
  expect(result.review).toContainEqual({id:"a",reason:"flag_collision_on_rename"});
});
it("preserves structured values, statuses, unknown events and ambiguous distances", () => {
  const result = planPbNormalization([
    {...row,event_name:"1500m",value_cs:24000},
    {...row,id:"b",event_name:"1500m",result_status:"DNF"},
    {...row,id:"c",event_name:"不明"},
    {...row,id:"d",event_name:"走幅跳",record:"6m5"},
  ],events);
  expect(result.patches).toEqual([]);
  expect(result.review).toHaveLength(2);
});
