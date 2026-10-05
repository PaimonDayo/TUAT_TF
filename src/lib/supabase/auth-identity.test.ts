import { createServerClient } from "@supabase/ssr";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/role-catalog", () => ({ getSharedRoleCatalog: mocks.catalog }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
// Outside an RSC request there is no React cache dispatcher.
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
import { getCurrentProfile, getCurrentUserId } from "./auth";

const memberId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const memberRole = "00000000-0000-4000-8000-000000000003";
const otherRole = "00000000-0000-4000-8000-000000000004";
let keys: CryptoKeyPair;
let jwk: JsonWebKey;
let fixtureNumber = 0;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});
beforeEach(() => vi.clearAllMocks());

async function fixture(options: {
  claims?: Record<string, unknown>;
  invalidSignature?: boolean;
  storageExpired?: boolean;
  refresh?: boolean;
  jwksFailure?: boolean;
  missingProfile?: boolean;
} = {}) {
  const origin = `https://identity-${++fixtureNumber}.example.invalid`;
  const cookieName = `sb-synthetic-identity-${fixtureNumber}`;
  const kid = `synthetic-key-${fixtureNumber}`;
  const now = Math.floor(Date.now() / 1000);
  async function sign(claims: Record<string, unknown>) {
    const unsigned = `${encode({ alg: "ES256", typ: "JWT", kid })}.${encode(claims)}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(unsigned));
    const bytes = new Uint8Array(signature);
    if (options.invalidSignature) bytes[0] ^= 1;
    return `${unsigned}.${Buffer.from(bytes).toString("base64url")}`;
  }
  const baseClaims = { sub: memberId, email: "member@example.invalid", aud: "authenticated", role: "authenticated", exp: now + 3600 };
  const token = await sign({ ...baseClaims, ...options.claims });
  const unverifiedUser = { id: otherId, email: "other@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-04T00:00:00Z" };
  const session = { access_token: token, refresh_token: "synthetic-refresh", expires_in: 3600, expires_at: options.storageExpired ? now - 60 : now + 3600, token_type: "bearer", user: unverifiedUser };
  const cookieWrites = vi.fn();
  const requests: URL[] = [];
  const fetchSynthetic: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe(origin);
    requests.push(url);
    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      if (options.jwksFailure) return Response.json({ message: "Synthetic Auth unavailable" }, { status: 503 });
      return Response.json({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
    }
    if (url.pathname === "/auth/v1/token" && options.refresh) {
      return Response.json({ ...session, access_token: await sign(baseClaims), expires_at: now + 3600, user: { ...unverifiedUser, id: memberId } });
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (options.missingProfile) return Response.json(null);
      const id = url.searchParams.get("id")?.slice(3);
      return Response.json({ id, email: `${id === memberId ? "member" : "other"}@example.invalid`, blocks: [], role: "member", approved: true, status: "active" });
    }
    if (url.pathname === "/rest/v1/profile_roles") {
      const id = url.searchParams.get("profile_id")?.includes(memberId) ? memberId : otherId;
      return Response.json([{ profile_id: id, role_id: id === memberId ? memberRole : otherRole }]);
    }
    if (url.pathname === "/rest/v1/roles") return Response.json([
      { id: memberRole, name: "Synthetic member", is_everyone: false, sort_order: 0, can_create_menu: false },
      { id: otherRole, name: "Synthetic editor", is_everyone: false, sort_order: 1, can_create_menu: true },
    ]);
    throw new Error("Unexpected synthetic endpoint");
  };
  const client = createServerClient(origin, "synthetic-anon", {
    cookieOptions: { name: cookieName }, global: { fetch: fetchSynthetic },
    cookies: { getAll: () => [{ name: cookieName, value: `base64-${encode(session)}` }], setAll: cookieWrites },
  });
  mocks.client.mockResolvedValue(client);
  return { client, requests, cookieWrites };
}

describe("verified server identity with the actual Supabase Auth library", () => {
  it("uses the signed subject even when the cookie user differs, without fetching DB or Auth user", async () => {
    const { client, requests, cookieWrites } = await fixture();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const claims = await client.auth.getClaims();
      expect(claims.data?.claims.sub).toBe(memberId);
      const loaded = await client.auth.getSession();
      expect(loaded.data.session?.user.id).toBe(otherId);
      requests.length = 0; // The public signing key is now cached.
      expect(await getCurrentUserId()).toBe(memberId);
      expect(requests).toEqual([]);
      expect(cookieWrites).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it("loads the verified member's profile and fresh roles independently of proxy validation", async () => {
    const { requests } = await fixture();
    const profile = await getCurrentProfile();
    expect(profile.id).toBe(memberId);
    expect(profile.roles.map(role => role.id)).toEqual([memberRole]);
    expect(profile.roles[0].can_create_menu).toBe(false);
    expect(requests.find(url => url.pathname.endsWith("/profiles"))?.searchParams.get("id")).toBe(`eq.${memberId}`);
    expect(requests.find(url => url.pathname.endsWith("/profile_roles"))?.searchParams.get("profile_id")).toContain(memberId);
    expect(requests.filter(url => url.pathname.startsWith("/auth/"))).toHaveLength(1); // Initial JWKS only.
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("rejects an invalid ES256 signature before any profile lookup and preserves cookies", async () => {
    const { requests, cookieWrites } = await fixture({ invalidSignature: true });
    await expect(getCurrentProfile()).rejects.toThrow("redirect:/login");
    expect(requests.every(url => url.pathname.endsWith("/jwks.json"))).toBe(true);
    expect(cookieWrites).not.toHaveBeenCalled();
  });

  it("rejects an expired signed token even when cookie expiry claims it is still valid", async () => {
    const { requests, cookieWrites } = await fixture({ claims: { exp: Math.floor(Date.now() / 1000) - 60 } });
    await expect(getCurrentUserId()).rejects.toThrow("redirect:/login");
    expect(requests).toEqual([]);
    expect(cookieWrites).not.toHaveBeenCalled();
  });

  it("allows an expired session after the actual library refreshes and verifies its new token", async () => {
    const { requests, cookieWrites } = await fixture({ storageExpired: true, refresh: true, claims: { exp: Math.floor(Date.now() / 1000) - 60 } });
    expect(await getCurrentUserId()).toBe(memberId);
    expect(requests.map(url => url.pathname)).toEqual(["/auth/v1/token", "/auth/v1/.well-known/jwks.json"]);
    expect(cookieWrites).toHaveBeenCalled();
    expect(requests.some(url => url.pathname.startsWith("/rest/"))).toBe(false);
  });

  it.each([undefined, "", 12])("rejects a missing or invalid signed subject (%s)", async sub => {
    const { requests, cookieWrites } = await fixture({ claims: { sub } });
    await expect(getCurrentProfile()).rejects.toThrow("redirect:/login");
    expect(requests.some(url => url.pathname.startsWith("/rest/"))).toBe(false);
    expect(cookieWrites).not.toHaveBeenCalled();
  });

  it("fails closed on validation failure without deleting the session cookie", async () => {
    const { cookieWrites, requests } = await fixture({ jwksFailure: true });
    await expect(getCurrentUserId()).rejects.toThrow("redirect:/login");
    expect(cookieWrites).not.toHaveBeenCalled();
    expect(requests.some(url => url.pathname.startsWith("/rest/"))).toBe(false);
  });

  it("uses only the verified email and subject when the profile row is not yet present", async () => {
    await fixture({ missingProfile: true });
    const profile = await getCurrentProfile();
    expect(profile.id).toBe(memberId);
    expect(profile.email).toBe("member@example.invalid");
    expect(profile.roles).toEqual([]);
  });
});
