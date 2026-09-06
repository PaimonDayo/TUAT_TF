import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), signed: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/image-storage", () => ({ signedImageUrl: mocks.signed, uploadImage: mocks.upload, removeImages: mocks.remove }));
import { GET as avatar } from "@/app/api/avatar/image/route";
import { GET as story } from "@/app/api/tweet-image/route";
import { POST as upload, DELETE as remove } from "@/app/api/tweet-image/upload/route";
const uid = "11111111-1111-4111-8111-111111111111";
const path = `${uid}/22222222-2222-4222-8222-222222222222.webp`;
const maybeSingle = vi.fn();
const limit = vi.fn();
const query = { select: vi.fn(), eq: vi.fn(), or: vi.fn(), maybeSingle, limit };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
  for (const method of [query.select, query.eq, query.or]) method.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: { id: "story", expires_at: "2026-09-06T01:00:00Z" }, error: null });
  limit.mockResolvedValue({ data: [], error: null });
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: uid } } }) }, from: () => query });
  mocks.signed.mockResolvedValue("https://images.example/signed");
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe("private image routes", () => {
  it("rejects unauthenticated reads and writes before accessing storage", async () => {
    mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    for (const handler of [avatar, story, upload, remove]) {
      expect((await handler(new Request(`https://app.example/api/image?path=${path}`))).status).toBe(401);
    }
    expect(mocks.signed).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not sign stories hidden by RLS or missing from the database", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect((await story(new Request(`https://app.example/api/tweet-image?path=${path}`))).status).toBe(404);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("bounds URL and redirect lifetimes by the story expiry", async () => {
    maybeSingle.mockResolvedValue({ data: { expires_at: "2026-09-06T00:00:45Z" } });
    const response = await story(new Request(`https://app.example/api/tweet-image?path=${path}`));
    expect(response.status).toBe(307);
    expect(mocks.signed.mock.calls[0][3]).toBe(45);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=15");
  });
  it("never signs an expired story even if a stale query returned it", async () => {
    maybeSingle.mockResolvedValue({ data: { expires_at: "2026-09-05T23:59:59Z" } });
    expect((await story(new Request(`https://app.example/api/tweet-image?path=${path}`))).status).toBe(404);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("rejects another user's draft deletion", async () => {
    const otherPath = path.replace(uid, "33333333-3333-4333-8333-333333333333");
    expect((await remove(new Request(`https://app.example/api/tweet-image/upload?path=${otherPath}`))).status).toBe(404);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not remove an attached image or one whose reference query failed", async () => {
    for (const result of [{ data: [{ id: "story" }], error: null }, { data: null, error: new Error("offline") }]) {
      limit.mockResolvedValueOnce(result);
      expect((await remove(new Request(`https://app.example/api/tweet-image/upload?path=${path}`))).status).toBe(409);
    }
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
