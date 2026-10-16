import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signed: vi.fn(),
  upload: vi.fn(),
  cleanup: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/image-storage", async original => ({
  ...await original<typeof import("@/lib/image-storage")>(),
  signedImageUrl: mocks.signed,
  uploadImage: mocks.upload,
}));
vi.mock("@/lib/note-image-cleanup", () => ({
  cleanupNoteImages: mocks.cleanup,
}));
vi.mock("sharp", () => ({ default: () => {
  const pipeline = { rotate: () => pipeline, resize: () => pipeline, webp: () => pipeline, toBuffer: async () => Buffer.from("converted") };
  return pipeline;
} }));
import { GET, POST, DELETE } from "@/app/api/note-image/route";
import { ImageNotFoundError } from "./image-storage";
const capacity: { count: number | null; error: unknown } = { count: 0,error: null };
const query = {
  then: (resolve: (value: typeof capacity) => unknown) => Promise.resolve(resolve(capacity)),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
};
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  capacity.count=0; capacity.error=null;
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  query.insert.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.create.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: () => query,
    rpc,
  });
  mocks.signed.mockResolvedValue("https://r2.example/signed");
  mocks.upload.mockResolvedValue(undefined);
});
describe("private note images", () => {
  it("canonicalizes UUID aliases before article admission and immutable storage", async () => {
    const article="aaaaaaaa-1111-4111-8111-111111111111", upload="bbbbbbbb-2222-4222-8222-222222222222";
    const image={ id: "image",path: `${article}/${upload}.webp` };
    query.maybeSingle.mockResolvedValueOnce({ data: { note_id: "note" },error: null })
      .mockResolvedValueOnce({ data: null,error: null });
    query.single.mockResolvedValue({ data: image,error: null });
    rpc.mockResolvedValue({ data: true,error: null });
    const request=new Request(`https://app.example/api/note-image?articleId=${article.toUpperCase()}&uploadId=${upload.toUpperCase()}`,{ method: "POST",headers: { "Content-Type": "image/webp" },body: "synthetic" });
    expect((await POST(request)).status).toBe(200);
    expect(mocks.upload.mock.calls[0][2]).toBe(image.path);
    expect(query.eq).toHaveBeenCalledWith("id",article);
    expect(query.eq).toHaveBeenCalledWith("article_id",article);
  });
  it("refuses a seventh image without consuming or publishing its body", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { note_id: "note" },error: null })
      .mockResolvedValueOnce({ data: null,error: null });
    rpc.mockResolvedValue({ data: true,error: null });
    capacity.count=6;
    const request=new Request("https://app.example/api/note-image?articleId=11111111-1111-4111-8111-111111111111&uploadId=22222222-2222-4222-8222-222222222222",{ method: "POST",headers: { "Content-Type": "image/webp" },body: "synthetic" });
    expect((await POST(request)).status).toBe(409);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
  });
  it("does not treat an unknown image count as an empty article", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { note_id: "note" },error: null })
      .mockResolvedValueOnce({ data: null,error: null });
    rpc.mockResolvedValue({ data: true,error: null });
    capacity.count=null;
    const request=new Request("https://app.example/api/note-image?articleId=11111111-1111-4111-8111-111111111111&uploadId=22222222-2222-4222-8222-222222222222",{ method: "POST",headers: { "Content-Type": "image/webp" },body: "synthetic" });
    expect((await POST(request)).status).toBe(503);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
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
  it("reports database failures as unavailable instead of hiding them as a missing image", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    expect((await GET(new Request("https://app.example/api/note-image?id=x"))).status).toBe(503);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("distinguishes a missing object from a signing outage", async () => {
    query.maybeSingle.mockResolvedValue({ data: { path: "allowed" }, error: null });
    mocks.signed.mockRejectedValueOnce(new ImageNotFoundError());
    expect((await GET(new Request("https://app.example/api/note-image?id=x"))).status).toBe(404);
    mocks.signed.mockRejectedValueOnce(new Error("private provider detail"));
    expect((await GET(new Request("https://app.example/api/note-image?id=x"))).status).toBe(503);
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
  it("reconciles a note image registered before its insert response was lost", async () => {
    const image = { id: "image", path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp" };
    query.maybeSingle.mockResolvedValueOnce({ data: { note_id: "note" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: image, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    query.single.mockResolvedValue({ data: null, error: { message: "private lost response" } });
    const response = await POST(new Request("https://app.example/api/note-image?articleId=11111111-1111-4111-8111-111111111111&uploadId=22222222-2222-4222-8222-222222222222", { method: "POST", headers: { "Content-Type": "image/webp" }, body: "synthetic" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(image);
    expect(query.insert).toHaveBeenCalledOnce();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("retains a note object when registration and reconciliation are both uncertain", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { note_id: "note" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "private lookup failure" } });
    rpc.mockResolvedValue({ data: true, error: null });
    query.single.mockRejectedValue(new Error("private lost response"));
    const response = await POST(new Request("https://app.example/api/note-image?articleId=11111111-1111-4111-8111-111111111111&uploadId=22222222-2222-4222-8222-222222222222", { method: "POST", headers: { "Content-Type": "image/webp" }, body: "synthetic" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
    expect(query.insert).toHaveBeenCalledOnce();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("keeps the six-photo limit response for a confirmed database rejection", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { note_id: "note" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    query.single.mockResolvedValue({ data: null, error: { code: "P0001", message: "An article can have at most 6 photos" } });
    const response = await POST(new Request("https://app.example/api/note-image?articleId=11111111-1111-4111-8111-111111111111&uploadId=22222222-2222-4222-8222-222222222222", { method: "POST", headers: { "Content-Type": "image/webp" }, body: "synthetic" }));
    expect(response.status).toBe(409);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
