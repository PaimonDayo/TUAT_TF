import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "verified-member" } as { id: string } | null,
  loginAccess: vi.fn(),
  profile: vi.fn(),
  identityFilter: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: state.loginAccess,
    from: (table: string) => {
      expect(table).toBe("profiles");
      return {
        select: () => ({
          eq: (...args: unknown[]) => {
            state.identityFilter(...args);
            return { maybeSingle: state.profile };
          },
        }),
      };
    },
  }),
}));
vi.mock("@/lib/image-storage", () => ({ signedImageUrl: state.sign }));

import { GET } from "./route";

const path = "another-member/avatar.webp";
function request(imagePath: string | null = path) {
  const url = new URL("https://app.example.test/api/avatar/image");
  if (imagePath !== null) url.searchParams.set("path", imagePath);
  return new Request(url);
}

beforeEach(() => {
  state.user = { id: "verified-member" };
  state.loginAccess.mockReset().mockResolvedValue({ data: true, error: null });
  state.profile.mockReset().mockResolvedValue({ data: { approved: true }, error: null });
  state.identityFilter.mockReset();
  state.sign.mockReset().mockResolvedValue("https://images.example.test/avatar?signature=synthetic");
});

describe("avatar image login and membership authorization", () => {
  it("signs an approved member's request and preserves delivery and cache settings", async () => {
    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://images.example.test/avatar?signature=synthetic");
    expect(response.headers.get("cache-control")).toBe("private, max-age=518400, immutable");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(state.loginAccess).toHaveBeenCalledWith("login_access_allowed");
    expect(state.identityFilter).toHaveBeenCalledWith("id", "verified-member");
    expect(state.sign).toHaveBeenCalledWith(expect.anything(), "avatars", path, 604800);
  });

  it("rejects an anonymous request before checking membership or signing", async () => {
    state.user = null;

    expect((await GET(request())).status).toBe(401);
    expect(state.loginAccess).not.toHaveBeenCalled();
    expect(state.profile).not.toHaveBeenCalled();
    expect(state.sign).not.toHaveBeenCalled();
  });

  it.each([
    { data: false, error: null },
    { data: null, error: { code: "PT403", message: "private access detail" } },
  ])("denies withdrawn login access (%j) before checking profiles or signing", async access => {
    state.loginAccess.mockResolvedValue(access);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain("private access detail");
    expect(state.profile).not.toHaveBeenCalled();
    expect(state.sign).not.toHaveBeenCalled();
  });

  it.each(["database error", "transport rejection"])("reports an unavailable login access check (%s) before checking profiles or signing", async failure => {
    if (failure === "database error") {
      state.loginAccess.mockResolvedValue({ data: null, error: { code: "08006", message: "private access detail" } });
    } else {
      state.loginAccess.mockRejectedValue(new Error("private access detail"));
    }

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain("private access detail");
    expect(state.profile).not.toHaveBeenCalled();
    expect(state.sign).not.toHaveBeenCalled();
  });

  it.each([{ approved: false }, null])("denies a missing or unapproved profile (%j) before signing", async profile => {
    state.profile.mockResolvedValue({ data: profile, error: null });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(state.sign).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["database error", "transport rejection"])("reports a membership lookup failure (%s) without issuing an image URL", async failure => {
    if (failure === "database error") {
      state.profile.mockResolvedValue({ data: { approved: true }, error: { message: "private database detail" } });
    } else {
      state.profile.mockRejectedValue(new Error("private database detail"));
    }

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    expect(state.sign).not.toHaveBeenCalled();
  });

  it.each([null, "../private.webp", "member/avatar.webp/extra"])("rejects an invalid image path (%s) without signing", async invalidPath => {
    expect((await GET(request(invalidPath))).status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
  });

  it("preserves the existing signing failure response without exposing provider details", async () => {
    state.sign.mockRejectedValue(new Error("private provider detail"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await GET(request());

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(JSON.stringify(await response.json())).not.toContain("private provider detail");
    } finally {
      warning.mockRestore();
    }
  });
});
