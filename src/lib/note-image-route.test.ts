import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signed: vi.fn(),
  upload: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/image-storage", () => ({
  signedImageUrl: mocks.signed,
  uploadImage: mocks.upload,
}));
vi.mock("@/lib/note-image-cleanup", () => ({
  cleanupNoteImages: mocks.cleanup,
}));
import { GET, POST, DELETE } from "@/app/api/note-image/route";
const query = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  delete: vi.fn(),
};
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.create.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: () => query,
    rpc,
  });
  mocks.signed.mockResolvedValue("https://r2.example/signed");
});
describe("private note images", () => {
  it("rejects anonymous reads, uploads and deletion before touching storage", async () => {
    mocks.create.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });
    for (const handler of [GET, POST, DELETE])
      expect(
        (await handler(new Request("https://app.example/api/note-image?id=x")))
          .status,
      ).toBe(401);
    expect(mocks.signed).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("does not sign an image whose parent note is hidden by RLS", async () => {
    expect(
      (await GET(new Request("https://app.example/api/note-image?id=x")))
        .status,
    ).toBe(404);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("uses private caching and a five-minute signed URL for permitted images", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { path: "allowed" },
      error: null,
    });
    const response = await GET(
      new Request("https://app.example/api/note-image?id=x"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=240");
    expect(mocks.signed.mock.calls[0].slice(1)).toEqual([
      "note-images",
      "allowed",
      300,
    ]);
  });
  it("checks edit permission before reading upload bytes", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { note_id: "note" },
      error: null,
    });
    rpc.mockResolvedValue({ data: false, error: null });
    const request = new Request(
      "https://app.example/api/note-image?articleId=article",
      { method: "POST", body: "not read" },
    );
    const read = vi.spyOn(request, "arrayBuffer");
    expect((await POST(request)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects unsupported types and oversized input before decoding", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { note_id: "note" },
      error: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });
    for (const [headers, status] of [
      [{ "Content-Type": "image/svg+xml" }, 415],
      [{ "Content-Type": "image/jpeg", "Content-Length": "99999999" }, 413],
    ] as const) {
      expect(
        (
          await POST(
            new Request(
              "https://app.example/api/note-image?articleId=article",
              { method: "POST", headers, body: "x" },
            ),
          )
        ).status,
      ).toBe(status);
    }
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("allows retry of an already completed deletion without touching other objects", async () => {
    expect(
      (
        await DELETE(
          new Request("https://app.example/api/note-image?id=x", {
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(200);
    expect(query.delete).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
