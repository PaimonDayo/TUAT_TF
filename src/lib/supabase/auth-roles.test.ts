import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
const mocks = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock("@/lib/supabase/role-catalog", () => ({ getSharedRoleCatalog: mocks.catalog }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { fetchRolesByProfileIds } from "./auth";

function role(id: string, everyone = false, order = 0): AppRole {
  return { id, name: id, color: "blue", category: null, is_everyone: everyone,
    is_system: false, sort_order: order, created_at: "2026-01-01",
    can_manage_system: false, can_manage_members: false, can_create_notice: false,
    can_create_menu: false, can_create_schedule: false, can_decide_practice: false };
}
function client(assignments: {profile_id: string; role_id: string}[], catalog: AppRole[], fail = false) {
  const query = { in: vi.fn().mockResolvedValue({ data: assignments, error: fail ? new Error("unavailable") : null }) };
  const from = vi.fn((table: string) => ({ select: vi.fn(() => table === "profile_roles" ? query : Promise.resolve({ data: catalog, error: null })) }));
  return { from, supabase: { from } as unknown as Parameters<typeof fetchRolesByProfileIds>[0] };
}
beforeEach(() => vi.clearAllMocks());
describe("role catalog isolation", () => {
  it("shares definitions without sharing member assignments or duplicating everyone roles", async () => {
    const catalog = [role("member", true, 2), role("staff", false, 1)];
    mocks.catalog.mockResolvedValue(catalog);
    const first = client([{profile_id:"a", role_id:"staff"},{profile_id:"a", role_id:"member"}], []);
    const second = client([], []);
    const a = await fetchRolesByProfileIds(first.supabase, ["a"], { useCachedCatalog: true });
    const b = await fetchRolesByProfileIds(second.supabase, ["b"], { useCachedCatalog: true });
    expect(a.get("a")?.map(r=>r.id)).toEqual(["staff", "member"]);
    expect(b.get("b")?.map(r=>r.id)).toEqual(["member"]);
    expect(first.from).toHaveBeenCalledTimes(1);
    expect(second.from).toHaveBeenCalledTimes(1);
    expect(catalog.map(r=>r.id)).toEqual(["member", "staff"]);
  });
  it("authorization callers use fresh roles even if a cached role would grant more", async () => {
    const fresh = role("staff");
    mocks.catalog.mockResolvedValue([{...fresh,can_manage_system:true}]);
    const c = client([{profile_id:"a",role_id:"staff"}], [fresh]);
    const result = await fetchRolesByProfileIds(c.supabase, ["a"]);
    expect(result.get("a")?.[0].can_manage_system).toBe(false);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(c.from).toHaveBeenCalledWith("roles");
  });
  it("failed assignments or definitions fail closed", async () => {
    mocks.catalog.mockResolvedValue([role("everyone",true)]);
    expect((await fetchRolesByProfileIds(client([],[],true).supabase,["a"],{useCachedCatalog:true})).size).toBe(0);
  });
  it("reads definitions as the member when the shared catalog is unavailable (PC down)", async () => {
    mocks.catalog.mockRejectedValue(new Error("unavailable"));
    const c = client([], [role("everyone", true)]);
    const result = await fetchRolesByProfileIds(c.supabase, ["a"], { useCachedCatalog: true });
    expect(result.get("a")?.map((r) => r.id)).toEqual(["everyone"]);
    expect(c.from).toHaveBeenCalledWith("roles");
  });
  it("empty requests make no database or catalog calls", async () => {
    const c=client([],[]);
    expect((await fetchRolesByProfileIds(c.supabase,[])).size).toBe(0);
    expect(c.from).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
