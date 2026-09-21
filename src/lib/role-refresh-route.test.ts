import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({ user:vi.fn(), member:vi.fn(), invalidate:vi.fn() }));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.user},rpc:mocks.member})}));
vi.mock("next/cache",()=>({revalidateTag:mocks.invalidate}));
vi.mock("@/lib/supabase/role-catalog",()=>({ROLE_CATALOG_TAG:"role-catalog"}));
import { POST } from "@/app/api/roles/refresh/route";
beforeEach(()=>vi.clearAllMocks());
const request=(origin="https://app.test")=>new Request("https://app.test/api/roles/refresh",{method:"POST",headers:{origin}});
it("rejects cross-origin and anonymous invalidation",async()=>{
  expect((await POST(request("https://elsewhere.test"))).status).toBe(403);
  mocks.user.mockResolvedValue({data:{user:null},error:null});
  expect((await POST(request())).status).toBe(401);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("requires current membership and expires the shared data immediately",async()=>{
  mocks.user.mockResolvedValue({data:{user:{id:"a"}},error:null});
  mocks.member.mockResolvedValueOnce({data:false,error:null}).mockResolvedValueOnce({data:true,error:null});
  expect((await POST(request())).status).toBe(403);
  expect((await POST(request())).status).toBe(200);
  expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith("role-catalog",{expire:0});
});
