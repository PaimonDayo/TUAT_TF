import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), filters: [] as string[][], results: {} as Record<string, {data: unknown[]; error: unknown}> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({from:mocks.from}) }));
import { getMyObDuties } from "./ob-entries";
import { getMyObParticipation } from "./ob-entries";
import { emptyPerformance } from "@/lib/meet-operations";

beforeEach(() => {
  mocks.filters = [];
  mocks.results = Object.fromEntries(["ob_meet_duties","ob_entry_duties","ob_duty_roles","ob_event_operations"].map(t=>[t,{data:[],error:null}]));
  mocks.from.mockImplementation((table:string) => {
    const chain = { select: () => chain, eq: (column:string,value:string) => {mocks.filters.push([table,column,value]);return chain;}, then: (resolve:(v:unknown)=>void) => Promise.resolve(mocks.results[table]).then(resolve) };
    return chain;
  });
});

const operation = (event: string, participants: ReturnType<typeof emptyPerformance>[]) => ({meet_key:"ob-2026",event_name:event,revision:1,data:{participants,confirmed:false},updated_at:"2026-10-11T00:00:00Z"});
it("returns only personal saved groups, mixed lanes, distance numbers and DNS", async () => {
  mocks.results.ob_event_operations.data = [
    operation("男子100m", [{...emptyPerformance("mine"),group:2,order:4,heatScope:"混合",status:"DNS"}, {...emptyPerformance("other"),group:1,order:1}]),
    operation("女子300m", [{...emptyPerformance("mine"),group:3,order:6}]),
    operation("男子1500m", [{...emptyPerformance("mine"),group:1,order:12}]),
    operation("男子3000m", [emptyPerformance("mine")]),
  ];
  expect(await getMyObParticipation("mine")).toEqual([
    {event:"男子100m",status:"DNS",placement:"混合2組・4レーン"},
    {event:"女子300m",status:"entered",placement:"女子3組・6レーン"},
    {event:"男子1500m",status:"entered",placement:"男子1組・12番"},
    {event:"男子3000m",status:"entered",placement:"組未定"},
  ]);
  expect(mocks.filters).toContainEqual(["ob_event_operations","meet_key","ob-2026"]);
});
it("calculates the full mixed field order before filtering to the viewer", async () => {
  mocks.results.ob_event_operations.data = [
    operation("男子走り幅跳び", [{...emptyPerformance("other"),group:1,order:1,heatScope:"混合"},{...emptyPerformance("mine"),group:1,order:3,heatScope:"混合"}]),
    operation("女子走り幅跳び", [{...emptyPerformance("another"),group:1,order:2,heatScope:"混合"}]),
    operation("男子砲丸投げ", [emptyPerformance("mine")]),
  ];
  expect(await getMyObParticipation("mine")).toEqual([
    {event:"男子走り幅跳び",status:"entered",placement:"試技順 3番"},
    {event:"男子砲丸投げ",status:"entered",placement:"順番未定"},
  ]);
});
it("does not turn operation fetch failure into an unset group", async () => {
  mocks.results.ob_event_operations.error = {message:"unavailable"};
  await expect(getMyObParticipation("mine")).rejects.toThrow("取得できませんでした");
});
const duty = {meet_key:"ob-2026",profile_id:"me",slot_time:"13:00",event_name:"走り高跳び",assignment:"計測",revision:0,role_ids:[]};

it("limits both storage types to confirmed identity, removes cleared assignments and sorts times",async()=>{
  mocks.results.ob_meet_duties.data=[duty,{...duty,slot_time:"15:00",assignment:""}];
  mocks.results.ob_entry_duties.data=[{...duty,profile_id:undefined,entry_id:"entry",slot_time:"11:00",event_name:"100m",role_ids:["r"]}];
  mocks.results.ob_duty_roles.data=[{id:"r",name:"計時",abbreviation:"計"}];
  expect(await getMyObDuties("me","entry")).toEqual([{time:"11:00",event:"100m",assignment:"計時"},{time:"13:00",event:"走り高跳び",assignment:"計測"}]);
  expect(mocks.filters).toContainEqual(["ob_meet_duties","profile_id","me"]);
  expect(mocks.filters).toContainEqual(["ob_entry_duties","entry_id","entry"]);
  for(const table of ["ob_meet_duties","ob_entry_duties","ob_duty_roles"])expect(mocks.filters).toContainEqual([table,"meet_key","ob-2026"]);
});
it("does not fetch unconfirmed entry assignments, even when the user has no registration",async()=>{
  mocks.results.ob_meet_duties.data=[duty];
  expect(await getMyObDuties("me",null)).toHaveLength(1);
  expect(mocks.from).not.toHaveBeenCalledWith("ob_entry_duties");
});
it("does not turn fetch errors or conflicting assignments into an empty schedule",async()=>{
  mocks.results.ob_meet_duties.error={message:"unavailable"};
  await expect(getMyObDuties("me","entry")).rejects.toThrow("取得できませんでした");
  mocks.results.ob_meet_duties={data:[duty],error:null};
  mocks.results.ob_entry_duties.data=[{...duty,entry_id:"entry"}];
  await expect(getMyObDuties("me","entry")).rejects.toThrow("重複");
});
