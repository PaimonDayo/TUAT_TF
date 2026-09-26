import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), preview: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), result: vi.fn(), refresh: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles, isMemberPreviewActive: mocks.preview }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { confirmEntryMember, saveEntry, saveParty, saveDuty, saveDutyRole, saveDutyRoles } from "./actions";
const id = "10000000-0000-4000-8000-000000000001";

it("limits duty writes to system users outside preview and rejects invalid slots",async()=>{
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
  mocks.roles.mockResolvedValue(new Map([["system", [{ can_manage_system: true }]]]));
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
  mocks.roles.mockResolvedValue(new Map([["system", [{ can_manage_system: true }]]]));
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
