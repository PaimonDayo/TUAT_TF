import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn(), roles: vi.fn(), list: vi.fn(), preview: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles }));
vi.mock("@/lib/queries", () => ({ getLoginAllowedEmails: mocks.list }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.preview ? {value:"1"} : undefined }) }));
import { DELETE, GET, POST } from "./route";

const entry = { email:"person@example.invalid", created_at:"2026-10-11", created_by:"manager" };
let user: ReturnType<typeof vi.fn>, insert: ReturnType<typeof vi.fn>, remove: ReturnType<typeof vi.fn>, select: ReturnType<typeof vi.fn>;
function request(method = "POST", email = "person@example.invalid", origin = "https://app.example.invalid") {
  return new NextRequest("https://app.example.invalid/api/admin/login-allowlist", { method, headers: {origin,"Content-Type":"application/json"}, body:JSON.stringify({email}) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.preview=false;
  user=vi.fn().mockResolvedValue({data:{user:{id:"manager"}},error:null});
  select=vi.fn().mockResolvedValue({data:[entry],error:null});
  insert=vi.fn(() => ({select})); remove=vi.fn(() => ({eq:vi.fn(() => ({select}))}));
  mocks.client.mockResolvedValue({auth:{getUser:user},from:vi.fn(() => ({insert,delete:remove}))});
  mocks.roles.mockResolvedValue(new Map([["manager",[{can_manage_members:false},{can_manage_members:true}]]]));
  mocks.list.mockResolvedValue([entry]);
});
describe("login allowlist management", () => {
  it("accepts the OR of verified member-management roles and normalizes email", async () => {
    const response=await POST(request("POST"," Person@Example.Invalid "));
    expect(response.status).toBe(200); expect(insert).toHaveBeenCalledWith({email:entry.email});
    expect(mocks.roles).toHaveBeenCalledWith(expect.anything(),["manager"]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("requires verified identity", async () => {
    user.mockResolvedValue({data:{user:null},error:null});
    expect((await POST(request())).status).toBe(401); expect(insert).not.toHaveBeenCalled();
  });
  it("rejects regular members, preview mode and other origins", async () => {
    mocks.roles.mockResolvedValue(new Map([["manager",[{can_manage_members:false}]]]));
    expect((await DELETE(request("DELETE"))).status).toBe(403);
    mocks.roles.mockResolvedValue(new Map([["manager",[{can_manage_members:true}]]])); mocks.preview=true;
    expect((await POST(request())).status).toBe(403);
    mocks.preview=false; expect((await POST(request("POST",entry.email,"https://other.example.invalid"))).status).toBe(403);
    expect(insert).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("does not turn a list failure into an empty list", async () => {
    mocks.list.mockRejectedValue(new Error("unavailable"));
    const response=await GET(); expect(response.status).toBe(503); expect((await response.json()).entries).toBeUndefined();
  });
  it("rejects university addresses and malformed addresses", async () => {
    expect((await POST(request("POST","person@st.go.tuat.ac.jp"))).status).toBe(400);
    expect((await POST(request("POST","bad address"))).status).toBe(400); expect(insert).not.toHaveBeenCalled();
  });
  it("confirms exactly one removed row", async () => {
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    select.mockResolvedValue({data:[],error:null});
    const response=await DELETE(request("DELETE")); expect(response.status).toBe(409);
    expect((await response.json()).uncertain).toBe(true);
  });
  it("reports unknown results without resending mutations", async () => {
    select.mockRejectedValue(new Error("connection lost"));
    const response=await POST(request()); expect(response.status).toBe(503);
    expect((await response.json()).uncertain).toBe(true); expect(insert).toHaveBeenCalledTimes(1);
  });
  it("distinguishes failover refusal from an unknown result", async () => {
    select.mockResolvedValue({data:null,error:{code:"PT503"}});
    const response=await POST(request()); expect(response.status).toBe(503);
    expect((await response.json()).unchanged).toBe(true);
  });
});
