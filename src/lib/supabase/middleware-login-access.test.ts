import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(() => ({client:vi.fn(),config:vi.fn()}));
vi.mock("@supabase/ssr",()=>({createServerClient:mocks.client}));
vi.mock("./server-client-options",()=>({sessionClientConfig:mocks.config}));
import { updateSession } from "./middleware";
let claims: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>, signOut: ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.config.mockReturnValue({url:"https://auth.example.invalid",key:"synthetic",options:{}});
  claims=vi.fn().mockResolvedValue({data:{claims:{sub:"person",email:"person@example.invalid"}},error:null});
  rpc=vi.fn().mockResolvedValue({data:true,error:null}); signOut=vi.fn().mockResolvedValue({error:null});
  mocks.client.mockImplementation((_url,_key,options)=>{
    options.cookies.setAll([{name:"synthetic-auth",value:"refreshed",options:{path:"/"}}]);
    return {auth:{getClaims:claims,signOut},rpc};
  });
});
describe("existing personal login sessions",()=>{
  it("keeps allowed sessions and refreshed cookies",async()=>{
    const response=await updateSession(new NextRequest("https://app.example.invalid/admin"));
    expect(response.status).toBe(200); expect(signOut).not.toHaveBeenCalled();
    expect(response.cookies.get("synthetic-auth")?.value).toBe("refreshed");
  });
  it("withdraws a revoked session and explains the account restriction",async()=>{
    rpc.mockResolvedValue({data:null,error:{code:"PT403"}});
    const response=await updateSession(new NextRequest("https://app.example.invalid/home"));
    expect(response.status).toBe(307); expect(response.headers.get("location")).toBe("https://app.example.invalid/login?error=domain");
    expect(signOut).toHaveBeenCalledWith({scope:"local"});
  });
  it("does not discard cookies during a failed permission check",async()=>{
    rpc.mockRejectedValue(new Error("network"));
    const response=await updateSession(new NextRequest("https://app.example.invalid/home"));
    expect(response.status).toBe(503); expect(signOut).not.toHaveBeenCalled();
    expect(response.cookies.get("synthetic-auth")?.value).toBe("refreshed");
  });
  it("preserves the university path without a new data roundtrip",async()=>{
    claims.mockResolvedValue({data:{claims:{sub:"student",email:"student@st.go.tuat.ac.jp"}}});
    expect((await updateSession(new NextRequest("https://app.example.invalid/home"))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});
