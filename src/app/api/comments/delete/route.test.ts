import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:{id:"u"} as {id:string}|null,preview:false,rpc:vi.fn(),flush:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user}})},rpc:state.rpc})}));
vi.mock("@/lib/supabase/auth",()=>({isMemberPreviewActive:async()=>state.preview}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:state.admin}));
vi.mock("@/lib/sheet-sync/reply-deletions",()=>({flushReplyDeletions:state.flush}));
import { POST } from "./route";
const id="10000000-0000-4000-8000-000000000001";
const req=(kind="app")=>new Request("http://localhost/api/comments/delete",{method:"POST",body:JSON.stringify({id,kind})});
beforeEach(()=>{state.user={id:"u"};state.preview=false;state.rpc.mockReset().mockResolvedValue({data:id,error:null});state.flush.mockReset().mockResolvedValue([]);state.admin.mockReset().mockReturnValue({});});
it("denies anonymous and preview without privileged work",async()=>{
 state.user=null;expect((await POST(req())).status).toBe(403);state.user={id:"u"};state.preview=true;expect((await POST(req())).status).toBe(403);expect(state.rpc).not.toHaveBeenCalled();expect(state.admin).not.toHaveBeenCalled();
});
it("relies on caller RPC authorization before sheet access",async()=>{
 state.rpc.mockResolvedValue({data:null,error:{code:"42501"}});expect((await POST(req())).status).toBe(403);expect(state.admin).not.toHaveBeenCalled();
});
it("uses only the trusted receipt and reports durable pending on sheet failure",async()=>{
 state.flush.mockRejectedValue(new Error("offline"));expect(await (await POST(req("sheet"))).json()).toEqual({ok:true,pending:true});expect(state.rpc).toHaveBeenCalledWith("delete_comment_with_sheet",{p_id:id,p_kind:"sheet"});expect(state.flush).toHaveBeenCalledWith({},id);
});
it("reports completed deletion and skips sheets for app-only comments",async()=>{
 expect(await (await POST(req())).json()).toEqual({ok:true,pending:false});state.rpc.mockResolvedValue({data:null,error:null});state.admin.mockClear();expect(await (await POST(req())).json()).toEqual({ok:true,pending:false});expect(state.admin).not.toHaveBeenCalled();
});
