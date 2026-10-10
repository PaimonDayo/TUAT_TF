import { describe, expect, it, vi } from "vitest";
import { loginAccessResponse, loginAccessStatus } from "./login-access";
type Client = Parameters<typeof loginAccessStatus>[0];
describe("login permission outcomes", () => {
  it("accepts only explicit true", async () => {
    expect(await loginAccessStatus({rpc:vi.fn().mockResolvedValue({data:true,error:null})} as unknown as Client)).toBe("allowed");
    expect(await loginAccessStatus({rpc:vi.fn().mockResolvedValue({data:false,error:null})} as unknown as Client)).toBe("denied");
  });
  it("distinguishes withdrawal from interrupted checks", async () => {
    expect(await loginAccessStatus({rpc:vi.fn().mockResolvedValue({data:null,error:{code:"PT403"}})} as unknown as Client)).toBe("denied");
    const rpc=vi.fn().mockRejectedValue(new Error("network"));
    expect(await loginAccessStatus({rpc} as unknown as Client)).toBe("unavailable");
    const response=await loginAccessResponse({rpc} as unknown as Client);
    expect(response?.status).toBe(503); expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
