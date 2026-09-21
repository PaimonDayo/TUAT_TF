import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession: mocks.session, getUser: mocks.user } }) }));
import { getCurrentUserId } from "./client-auth";
beforeEach(() => vi.clearAllMocks());
it("reads only the current session for an RLS identity hint", async () => {
  mocks.session.mockResolvedValue({data:{session:{user:{id:"member"}}},error:null});
  expect(await getCurrentUserId()).toBe("member");
  expect(mocks.user).not.toHaveBeenCalled();
});
it("does not reuse an identity after logout or a session failure", async () => {
  mocks.session.mockResolvedValueOnce({data:{session:{user:{id:"member"}}},error:null})
    .mockResolvedValueOnce({data:{session:null},error:null})
    .mockResolvedValueOnce({data:{session:{user:{id:"member"}}},error:new Error("expired")});
  expect(await getCurrentUserId()).toBe("member");
  expect(await getCurrentUserId()).toBeNull();
  expect(await getCurrentUserId()).toBeNull();
});
