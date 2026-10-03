import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), preview: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), result: vi.fn(), refresh: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles, isMemberPreviewActive: mocks.preview }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { createGuestEntry, deleteEntry, confirmEntryMember, saveEntry, saveParty, saveDuty, saveDutyRole, saveDutyRoles, deleteDutyRole, getObEntryHistory } from "./actions";
const id = "10000000-0000-4000-8000-000000000001";

it("deletes only the expected role and refreshes only after its ID is returned",async()=>{
 const input={id,slotTime:"11:00",eventName:"100m",revision:2};
 for(const data of [null,0,"other"]){mocks.rpc.mockResolvedValueOnce({data,error:null});expect((await deleteDutyRole(input)).ok).toBe(false);}
 expect(mocks.refresh).not.toHaveBeenCalled();
 mocks.rpc.mockResolvedValueOnce({data:id,error:null});expect(await deleteDutyRole(input)).toEqual({ok:true});
 expect(mocks.rpc).toHaveBeenLastCalledWith("delete_ob_duty_role",{p_id:id,p_slot_time:"11:00",p_event_name:"100m",p_revision:2});
 expect(mocks.refresh).toHaveBeenCalled();
});
it("refuses role deletion by anonymous, ordinary, system-only and preview users",async()=>{
 const input={id,slotTime:"11:00",eventName:"100m",revision:0};
 mocks.user.mockResolvedValueOnce({data:{user:null}});expect((await deleteDutyRole(input)).ok).toBe(false);
 mocks.roles.mockResolvedValueOnce(new Map());expect((await deleteDutyRole(input)).ok).toBe(false);
 mocks.roles.mockResolvedValueOnce(new Map([["system",[{name:"システム",can_manage_system:true}]]]));expect((await deleteDutyRole(input)).ok).toBe(false);
 mocks.preview.mockResolvedValueOnce(true);expect((await deleteDutyRole(input)).ok).toBe(false);
 for(const change of [{id:"bad"},{revision:-1},{revision:1.2},{revision:null},{slotTime:"12:34"},{eventName:"1500m"}])expect((await deleteDutyRole({...input,...change} as typeof input)).ok).toBe(false);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it("explains assigned and changed roles without reporting deletion success",async()=>{
 const input={id,slotTime:"11:00",eventName:"100m",revision:0};
 mocks.rpc.mockResolvedValueOnce({error:{message:"role_assigned"}});expect((await deleteDutyRole(input)).message).toContain("担当を解除");
 mocks.rpc.mockResolvedValueOnce({error:{message:"entry_conflict"}});expect((await deleteDutyRole(input)).message).toContain("更新されています");
 expect(mocks.refresh).not.toHaveBeenCalled();
});

it("saves unregistered helpers by entry ID and never reports absent revisions as success",async()=>{
 const input={profileId:id,entryId:id,slotTime:"11:00",eventName:"100m",roleIds:[],revision:null};
 mocks.rpc.mockResolvedValueOnce({data:0,error:null});
 expect((await saveDutyRoles(input)).ok).toBe(true);
 expect(mocks.rpc).toHaveBeenLastCalledWith("save_ob_entry_duty_roles",{p_entry_id:id,p_slot_time:"11:00",p_event_name:"100m",p_role_ids:[],p_revision:null});
 mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect((await saveDutyRoles(input)).ok).toBe(false);
 mocks.rpc.mockResolvedValueOnce({error:{message:"entry_duty_busy"}});expect((await saveDutyRoles(input)).message).toContain("別種目");
 expect((await saveDutyRoles({...input,entryId:"bad"})).ok).toBe(false);
 mocks.preview.mockResolvedValueOnce(true);expect((await saveDutyRoles(input)).ok).toBe(false);
 mocks.roles.mockResolvedValueOnce(new Map());expect((await saveDutyRoles(input)).ok).toBe(false);
});

it("limits duty writes to OB staff outside preview and rejects invalid slots",async()=>{
  const input={profileId:id,slotTime:"10:00",eventName:"1500m",assignment:"周回表示",revision:null};
  mocks.user.mockResolvedValueOnce({data:{user:null}});
  expect((await saveDuty(input)).ok).toBe(false);
  mocks.roles.mockResolvedValueOnce(new Map());
  expect((await saveDuty(input)).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await saveDuty(input)).ok).toBe(false);
  expect((await saveDuty({...input,slotTime:"00:00"})).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reports duty conflicts and refreshes only successful saves",async()=>{
  const input={profileId:id,slotTime:"10:00",eventName:"1500m",assignment:"周回表示",revision:0};
  mocks.rpc.mockResolvedValueOnce({error:{message:"entry_conflict"}});
  expect((await saveDuty(input)).message).toContain("更新されています");
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({data:1,error:null});
  expect(await saveDuty(input)).toEqual({ok:true,revision:1});
  expect(mocks.rpc).toHaveBeenLastCalledWith("save_ob_duty",{p_profile_id:id,p_slot_time:"10:00",p_event_name:"1500m",p_assignment:"周回表示",p_revision:0});
  expect(mocks.refresh).toHaveBeenCalledWith("/ob-entries");
});

it("refuses party updates by ordinary members and preview sessions", async () => {
  mocks.roles.mockResolvedValueOnce(new Map());
  expect((await saveParty({id,revision:0,status:"参加"})).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await saveParty({id,revision:0,status:"参加"})).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("saves the entry and party response through one transaction",async()=>{
  expect((await saveEntry({entryId:id,profileId:null,revision:0,events:[],marks:{}},{id,revision:2,status:"不参加"})).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("save_ob_registration",expect.objectContaining({p_entry_id:id,p_party_id:id,p_party_revision:2,p_party_status:"不参加"}));
  mocks.rpc.mockResolvedValueOnce({error:{message:"entry_conflict"}});
  expect((await saveParty({id,revision:0,status:"参加"})).message).toContain("更新されています");
});

beforeEach(() => {
  mocks.user.mockResolvedValue({ data: { user: { id: "system" } } });
  mocks.roles.mockResolvedValue(new Map([["system", [{ name: "OB戦2026", can_manage_system: false, can_manage_members: false }]]]));
  mocks.preview.mockResolvedValue(false);
  const chain = { update: mocks.update, eq: mocks.eq, select: () => chain, maybeSingle: mocks.result };
  mocks.from.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.result.mockResolvedValue({ data: { id }, error: null });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});

it("rejects entry edits from preview sessions (ordinary members are limited to their own entry by the DB)", async () => {
  const input = { entryId: id, profileId: null, revision: 0, events: ["男子100m"], marks: {} };
  mocks.roles.mockResolvedValue(new Map([["system", [{ name: "OB戦2026", can_manage_system: false, can_manage_members: false }]]]));
  mocks.preview.mockResolvedValue(true);
  expect((await saveEntry(input)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it("does not report success when concurrent editing invalidates a revision", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "entry_conflict" } });
  expect((await saveEntry({ entryId: id, profileId: null, revision: 0, events: [], marks: {} })).message).toContain("更新されています");
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("refuses anonymous, ordinary members and preview before any data access", async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  mocks.roles.mockResolvedValueOnce(new Map());
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  expect(mocks.from).not.toHaveBeenCalled();
});

it("rejects invalid identifiers and revisions", async () => {
  expect((await confirmEntryMember("invalid", null, 0)).ok).toBe(false);
  expect((await confirmEntryMember(id, null, -1)).ok).toBe(false);
  expect(mocks.user).not.toHaveBeenCalled();
});

it("rejects a missing or inactive target member", async () => {
  mocks.result.mockResolvedValueOnce({ data: null, error: null });
  expect((await confirmEntryMember(id, id, 0)).ok).toBe(false);
  expect(mocks.eq).toHaveBeenCalledWith("status", "active");
  expect(mocks.eq).toHaveBeenCalledWith("approved", true);
  expect(mocks.update).not.toHaveBeenCalled();
});

it("reports a stale revision without reporting success or refreshing", async () => {
  mocks.result.mockResolvedValueOnce({ data: null, error: null });
  const result = await confirmEntryMember(id, null, 3);
  expect(result.ok).toBe(false);
  expect(mocks.eq).toHaveBeenCalledWith("revision", 3);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("preserves uniqueness failures and refreshes only after a successful link change", async () => {
  mocks.result.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledWith("/ob-entries");
});

it("checks system permission for staffing configuration and selections",async()=>{
 const role={id:null,slotTime:"10:00",eventName:"1500m",name:"計時",abbreviation:"計",requiredCount:1,revision:null};
 mocks.roles.mockResolvedValueOnce(new Map());expect((await saveDutyRole(role)).ok).toBe(false);
 mocks.preview.mockResolvedValueOnce(true);expect((await saveDutyRoles({profileId:id,slotTime:"10:00",eventName:"1500m",roleIds:[],revision:null})).ok).toBe(false);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reports capacity errors and sends multiple roles atomically",async()=>{
 const input={profileId:id,slotTime:"10:00",eventName:"1500m",roleIds:[id],revision:null};
 mocks.rpc.mockResolvedValueOnce({error:{message:"role_full"}});expect((await saveDutyRoles(input)).message).toContain("必要人数");expect(mocks.refresh).not.toHaveBeenCalled();
 mocks.rpc.mockResolvedValueOnce({data:0,error:null});expect((await saveDutyRoles(input)).ok).toBe(true);
 expect(mocks.rpc).toHaveBeenLastCalledWith("save_ob_duty_roles",{p_profile_id:id,p_slot_time:"10:00",p_event_name:"1500m",p_role_ids:[id],p_revision:null});
});


it("refuses history reads by staff, anonymous and preview sessions before querying", async () => {
  expect((await getObEntryHistory()).ok).toBe(false);
  mocks.user.mockResolvedValueOnce({data:{user:null}});
  expect((await getObEntryHistory()).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await getObEntryHistory()).ok).toBe(false);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("does not grant administrators other-person editing without the OB role", async () => {
  mocks.roles.mockResolvedValue(new Map([["system", [{name:"システム",can_manage_system:true,can_manage_members:true}]]]));
  expect((await confirmEntryMember(id,null,0)).ok).toBe(false);
  expect((await saveParty({id,revision:0,status:"参加"})).ok).toBe(false);
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});


it("pages administrator history and resolves the actor without returning raw snapshots", async () => {
  mocks.roles.mockResolvedValue(new Map([["system", [{name:"管理者",can_manage_system:false,can_manage_members:true}]]]));
  const rows = Array.from({length:31},(_,i)=>({id:`change-${i}`,actor_id:id,changed_at:"2026-09-28T00:00:00+00:00",before_data:{events:["男子100m"]},after_data:{submitted_name:"対象",events:[]}}));
  const filter=vi.fn(); const limit=vi.fn();
  const historyChain = { select:()=>historyChain, eq:()=>historyChain, order:()=>historyChain, limit:(n:number)=>{limit(n);return historyChain;}, or:(value:string)=>{filter(value);return historyChain;}, then:(resolve:(value:unknown)=>void)=>resolve({data:rows,error:null}) };
  const peopleChain = {select:()=>peopleChain,in:()=>Promise.resolve({data:[{id,display_name:"担当者"}],error:null})};
  mocks.from.mockImplementation(table=>table==="ob_entry_changes"?historyChain:peopleChain);
  const result=await getObEntryHistory({id,at:"2026-09-28T01:00:00Z"});
  expect(result.ok).toBe(true);
  if(result.ok) {
    expect(result.items).toHaveLength(30); expect(result.nextCursor?.id).toBe("change-29");
    expect(result.items[0]).toMatchObject({actor:"担当者",subject:"対象",details:expect.arrayContaining(["種目取消：男子100m"])});
    expect(result.items[0]).not.toHaveProperty("after_data");
  }
  expect(limit).toHaveBeenCalledWith(31);
  expect(filter).toHaveBeenCalledWith(`changed_at.lt.2026-09-28T01:00:00Z,and(changed_at.eq.2026-09-28T01:00:00Z,id.lt.${id})`);
});
it("rejects malformed history cursors before database access", async()=>{
  expect((await getObEntryHistory({id:"bad",at:"invalid"})).ok).toBe(false);
  expect(mocks.from).not.toHaveBeenCalled();
});

it("registers a named guest and requires the returned ID for deletion", async()=>{
  const guest={name:" 合成参加者 ",grade:"B1",events:["男子100m"],marks:{},partyStatus:"未回答"};
  expect((await createGuestEntry(guest)).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenLastCalledWith("create_ob_guest_registration",expect.objectContaining({p_name:"合成参加者",p_grade:"B1"}));
  mocks.rpc.mockResolvedValueOnce({data:null,error:null});
  expect((await deleteEntry({entryId:id,revision:1})).ok).toBe(false);
  expect((await deleteEntry({entryId:id,revision:1})).ok).toBe(true);
});
it("rejects invalid names and grades without DB writes", async()=>{
  for(const [name,grade] of [[" ","B1"],["x".repeat(101),"B1"],["合成","unknown"]]) {
    expect((await createGuestEntry({name,grade,events:["男子100m"],marks:{},partyStatus:"参加"})).ok).toBe(false);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("keeps guest addition and deletion staff-only, including preview mode", async()=>{
  const guest={name:"合成",grade:"OB・OG",events:["女子100m"],marks:{},partyStatus:"不参加"};
  mocks.roles.mockResolvedValue(new Map([["system",[{name:"システム",can_manage_system:true}]]]));
  expect((await createGuestEntry(guest)).ok).toBe(false);
  expect((await deleteEntry({entryId:id,revision:0})).ok).toBe(false);
  mocks.roles.mockResolvedValue(new Map([["system",[{name:"OB戦2026",can_manage_system:false}]]]));
  mocks.preview.mockResolvedValue(true);
  expect((await createGuestEntry(guest)).ok).toBe(false);
  expect((await deleteEntry({entryId:id,revision:0})).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("explains retained duties and race data when deletion is refused",async()=>{
  for(const [error,expected] of [["entry_has_duties","補助担当"],["entry_has_operations","競技記録"]]) {
    mocks.rpc.mockResolvedValueOnce({error:{message:error}});
    expect((await deleteEntry({entryId:id,revision:0})).message).toContain(expected);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});
