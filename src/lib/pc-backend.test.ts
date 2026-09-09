import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { verifyPcEndpoint } from "./pc-backend";
import { allowedPcBrowserApi, isMemberBearer } from "./pc-browser-api";

afterEach(() => vi.unstubAllEnvs());
describe("PC backend boundary", () => {
  const key = "test-key-".repeat(8), instance = "17cac21b-28a3-4e61-b7fd-96a6d6c20460";
  function endpoint(origin = "https://test-pc.trycloudflare.com", expiresAt = 101000) {
    return { version: 1, origin, instanceId: instance, expiresAt,
      signature: createHmac("sha256", key).update(JSON.stringify([1, origin, instance, expiresAt])).digest("hex") };
  }
  it("accepts only a fresh, signed endpoint for this PC", () => {
    expect(verifyPcEndpoint(endpoint(), key, instance, 100000).origin).toContain("trycloudflare.com");
    for (const invalid of [endpoint("https://attacker.example"), endpoint("http://127.0.0.1"), endpoint("https://test-pc.trycloudflare.com/redirect"), endpoint(undefined, 99999), endpoint(undefined, 999999), { ...endpoint(), signature: "a".repeat(64) }]) {
      expect(() => verifyPcEndpoint(invalid, key, instance, 100000)).toThrow();
    }
    expect(() => verifyPcEndpoint(endpoint(), key, "other-instance", 100000)).toThrow();
  });
  it("does not expose admin, password, signup, functions, storage writes or encoded paths to browsers", () => {
    const query = new URLSearchParams();
    for (const path of ["/auth/v1/admin/users", "/auth/v1/signup", "/auth/v1/otp", "/functions/v1/send-web-push", "/storage/v1/object/test", "/rest/v1/%2e%2e/auth", "/rest/v1/../auth", "/rest/v1/a%2Fb"]) {
      expect(allowedPcBrowserApi(path, "POST", query)).toBe(false);
    }
    expect(allowedPcBrowserApi("/auth/v1/token", "POST", new URLSearchParams("grant_type=password"))).toBe(false);
    expect(allowedPcBrowserApi("/auth/v1/token", "POST", new URLSearchParams("grant_type=pkce"))).toBe(true);
    expect(allowedPcBrowserApi("/auth/v1/token", "POST", new URLSearchParams("grant_type=refresh_token"))).toBe(true);
    expect(allowedPcBrowserApi("/auth/v1/authorize", "GET", new URLSearchParams("provider=google"))).toBe(true);
    expect(allowedPcBrowserApi("/rest/v1/competition_goals", "PATCH", query)).toBe(true);
  });
  it("rejects privileged and malformed bearer tokens before forwarding", () => {
    const bearer = (role: string) => `Bearer x.${Buffer.from(JSON.stringify({ role, sub: instance })).toString("base64url")}.x`;
    expect(isMemberBearer(bearer("service_role"))).toBe(false);
    expect(isMemberBearer(bearer("anon"))).toBe(false);
    expect(isMemberBearer("Bearer invalid")).toBe(false);
    expect(isMemberBearer(bearer("authenticated"))).toBe(true);
  });
});
