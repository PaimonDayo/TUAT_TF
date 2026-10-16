import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "owner" } as { id: string } | null, from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: state.from, rpc: state.rpc }) }));
import { POST } from "./route";
beforeEach(() => { state.user = { id: "owner" }; state.from.mockClear(); state.rpc.mockClear(); });
it("requires verified authentication", async () => {
  state.user = null;
  expect((await POST()).status).toBe(401);
});
it("retires old reply writes without reading, changing, or replaying any data", async () => {
  expect((await POST()).status).toBe(410);
  expect((await POST()).status).toBe(410);
  expect(state.from).not.toHaveBeenCalled();
  expect(state.rpc).not.toHaveBeenCalled();
});
