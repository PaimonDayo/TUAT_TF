import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), filters: [] as string[][], results: {} as Record<string, {data: unknown[]; error: unknown}> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({from:mocks.from}) }));
import { getMyObDuties } from "./ob-entries";

beforeEach(() => {
  mocks.filters = [];
  mocks.results = Object.fromEntries(["ob_meet_duties","ob_entry_duties","ob_duty_roles"].map(t=>[t,{data:[],error:null}]));
  mocks.from.mockImplementation((table:string) => {
    const chain = { select: () => chain, eq: (column:string,value:string) => {mocks.filters.push([table,column,value]);return chain;}, then: (resolve:(v:unknown)=>void) => Promise.resolve(mocks.results[table]).then(resolve) };
    return chain;
  });
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
