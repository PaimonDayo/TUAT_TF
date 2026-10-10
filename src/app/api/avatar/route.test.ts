import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  avatar: "verified-member/old.webp" as string | null,
  user: { id: "verified-member" } as { id: string } | null,
  readError: false,
  readCount: 0,
  updateFailure: "" as "" | "after-commit" | "before-commit" | "throw-after-commit",
  concurrentAvatar: undefined as string | null | undefined,
  updateCount: 0,
  filters: [] as [string, unknown][],
  upload: vi.fn(),
  remove: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc: state.access,
    from: () => {
      let values: { avatar_url: string | null } | undefined;
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        update: (next: { avatar_url: string | null }) => { values = next; return query; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        is: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => {
          if (!values) {
            state.readCount++;
            if (state.readError && state.readCount > 1) return { data: null, error: { code: "08006", message: "private lookup failure" } };
            return { data: { avatar_url: state.avatar }, error: null };
          }
          state.updateCount++;
          state.filters = filters;
          if (state.concurrentAvatar !== undefined) state.avatar = state.concurrentAvatar;
          if (filters.some(([column, value]) => column === "avatar_url" && value !== state.avatar)) return { data: null, error: null };
          if (state.updateFailure === "before-commit") return { data: null, error: { message: "private response failure" } };
          state.avatar = values.avatar_url;
          if (state.updateFailure === "throw-after-commit") throw new Error("private response failure");
          if (state.updateFailure === "after-commit") return { data: null, error: { message: "private response failure" } };
          return { data: { id: "verified-member", avatar_url: state.avatar }, error: null };
        },
      };
      return query;
    },
  }),
}));
vi.mock("sharp", () => ({ default: () => {
  const pipeline = { resize: () => pipeline, webp: () => pipeline, toBuffer: async () => Buffer.from("converted") };
  return pipeline;
} }));
vi.mock("@/lib/image-storage", async original => ({ ...await original<typeof import("@/lib/image-storage")>(), uploadImage: state.upload, removeImages: state.remove }));

import { POST, DELETE } from "./route";

function request() {
  return new Request("https://app.example.test/api/avatar", { method: "POST", headers: { "Content-Type": "image/webp" }, body: "synthetic" });
}
beforeEach(() => {
  state.avatar = "verified-member/old.webp";
  state.user = { id: "verified-member" };
  state.readError = false;
  state.readCount = 0;
  state.updateCount = 0;
  state.updateFailure = "";
  state.concurrentAvatar = undefined;
  state.filters = [];
  state.upload.mockReset().mockResolvedValue(undefined);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.access.mockReset().mockResolvedValue({ data: true, error: null });
});

describe("avatar save result reconciliation", () => {
  it("preserves and reports an avatar saved before its database response was lost", async () => {
    state.updateFailure = "after-commit";
    const response = await POST(request());
    expect(state.remove).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect((await response.json()).avatarUrl).toBe(state.avatar);
    expect(state.avatar).toBe(state.upload.mock.calls[0][2]);
    expect(state.updateCount).toBe(1);
  });

  it("keeps both images when a save cannot be confirmed", async () => {
    state.updateFailure = "before-commit";
    const response = await POST(request());
    expect(state.remove).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(state.updateCount).toBe(1);
  });
  it("retains a new object even if an unresolved database update commits after the reconciliation read", async () => {
    state.updateFailure = "before-commit";
    expect((await POST(request())).status).toBe(503);
    expect(state.avatar).toBe("verified-member/old.webp");
    // Model the still-running original update committing after the negative reread.
    state.avatar = state.upload.mock.calls[0][2];
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.updateCount).toBe(1);
  });

  it("reconciles a transport exception after commit without replaying the save", async () => {
    state.updateFailure = "throw-after-commit";
    expect((await POST(request())).status).toBe(200);
    expect(state.updateCount).toBe(1);
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("retains the uploaded object when the reconciliation lookup fails", async () => {
    state.updateFailure = "after-commit";
    state.readError = true;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("private");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
      expect(state.remove).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it.each(["post", "delete"])("preserves another device's replacement during %s", async operation => {
    state.concurrentAvatar = "verified-member/winner.webp";
    const response = operation === "post" ? await POST(request()) : await DELETE();
    expect(response.status).toBe(409);
    expect(state.avatar).toBe("verified-member/winner.webp");
    expect(state.filters).toContainEqual(["avatar_url", "verified-member/old.webp"]);
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.updateCount).toBe(1);
  });

  it("uses a null comparison for the first upload and retains retired images on successful replacement", async () => {
    state.avatar = null;
    expect((await POST(request())).status).toBe(200);
    expect(state.filters).toContainEqual(["avatar_url", null]);
    expect(state.remove).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("confirms a completed reference deletion despite a lost response", async () => {
    state.updateFailure = "after-commit";
    expect((await DELETE()).status).toBe(200);
    expect(state.avatar).toBeNull();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.updateCount).toBe(1);
  });

  it("does not upload or change profiles after access has been revoked", async () => {
    state.access.mockResolvedValue({ data: false, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.updateCount).toBe(0);
  });
});
