import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
const mock = vi.hoisted(() => ({ roles: [] as {name:string; can_manage_system:boolean; can_manage_members:boolean; permissions_suppressed?:boolean}[], program: vi.fn(), roster: vi.fn(), operations: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile: async () => ({id:"me",display_name:"自分",grade:"B1",roles:mock.roles}) }));
vi.mock("@/lib/queries", () => ({getCompetitionById:async(id:string)=>({id,name:"大会",starts_on:"2026-11-01"}),getCompetitionProgramEntries:async()=>[]}));
vi.mock("@/lib/queries/ob-entries", () => ({getMyObEntryFull:async()=>({entry:null,party:null}),getObProgram:mock.program,getObEntries:mock.roster}));
vi.mock("@/lib/queries/ob-operations", () => ({getObEventOperations:mock.operations}));
vi.mock("@/components/features/ObMeetWorkspace",()=>({ObMeetWorkspace:"workspace"}));
vi.mock("@/components/features/ObPublicProgram",()=>({ObPublicProgram:"program"}));
vi.mock("@/components/features/ObEntryHistory",()=>({ObEntryHistory:"history"}));
vi.mock("@/components/features/ObMyEntry",()=>({ObMyEntry:"mine"}));
vi.mock("@/components/features/ObOperations",()=>({ObOperations:"operations"}));
vi.mock("@/components/features/ObDayWorkspace",()=>({ObDayWorkspace:"day"}));
vi.mock("@/components/features/ObMeetParticipants",()=>({ObMeetParticipants:"participants"}));
vi.mock("@/components/features/CompetitionProgramView",()=>({CompetitionProgramView:"other"}));
vi.mock("@/components/layout/SubHeader",()=>({SubHeader:"header"}));
import Page from "./page";
import { OB_MEET } from "@/lib/ob-meet";
function find(node:ReactNode,type:string):Record<string,unknown> | undefined {
  if(Array.isArray(node))return node.map(n=>find(n,type)).find(Boolean);
  if(!isValidElement<Record<string,unknown>>(node))return;
  if(node.type===type)return node.props;
  return find(node.props.children as ReactNode,type);
}
async function workspace(edit?:string) {
  return find(await Page({params:Promise.resolve({id:OB_MEET.competitionId}),searchParams:Promise.resolve({edit})}),"workspace")!;
}
beforeEach(()=>{
  mock.roles=[];
  mock.program.mockResolvedValue({entries:[],members:[],duties:[],roles:[],operations:[]});
  mock.roster.mockResolvedValue(Object.fromEntries(["entries","members","history","party","duties","dutyRoles"].map(key=>[key,{data:[]}])));
  mock.operations.mockResolvedValue([]);
});
it("shows common read views without loading privileged data for ordinary members",async()=>{
  const w=await workspace("identity");expect(w.initialView).toBe("program");expect(w.management).toBeUndefined();expect(find(w.program as ReactNode,"program")).toBeDefined();expect(find(w.duties as ReactNode,"program")?.view).toBe("duties");expect(mock.roster).not.toHaveBeenCalled();
});
it("preserves the home edit link for the viewer",async()=>{
  const w=await workspace("mine");expect(w.initialView).toBe("mine");expect(find(w.mine as ReactNode,"mine")?.openEditor).toBe(true);
});
it("keeps staff registration management separate from system operation editing",async()=>{
  mock.roles=[{name:"OB戦2026",can_manage_system:false,can_manage_members:false}];
  const w=await workspace("identity");expect(w.initialView).toBe("management");expect(find(w.management as ReactNode,"participants")?.initialFilter).toBe("identity");expect(find(w.day as ReactNode,"day")?.canRegister).toBe(true);expect(mock.program).not.toHaveBeenCalled();expect(mock.roster).toHaveBeenCalledTimes(1);
});
it("opens staff participants with every entry and the history only for history viewers",async()=>{
  mock.roles=[{name:"OB戦2026",can_manage_system:false,can_manage_members:false}];
  const participants=find((await workspace()).management as ReactNode,"participants")!;expect(participants.initialFilter).toBe("all");expect(participants.footer).toBeUndefined();
  mock.roles=[...mock.roles,{name:"部員管理",can_manage_system:false,can_manage_members:true}];
  const withHistory=find((await workspace()).management as ReactNode,"participants")!;expect(isValidElement(withHistory.footer)&&withHistory.footer.type).toBe("history");
});
it("allows system operation management without granting helper edits",async()=>{
  mock.roles=[{name:"system",can_manage_system:true,can_manage_members:false}];
  const w=await workspace();expect(w.initialView).toBe("day");expect(find(w.day as ReactNode,"day")?.canRegister).toBe(false);expect(w.management).toBeUndefined();expect(find(w.duties as ReactNode,"program")?.canEditDuties).toBe(false);
});
it("does not give a suppressed staff role a management tab",async()=>{
  mock.roles=[{name:"OB戦2026",can_manage_system:false,can_manage_members:false,permissions_suppressed:true}];
  expect((await workspace()).management).toBeUndefined();expect(mock.roster).not.toHaveBeenCalled();
});
