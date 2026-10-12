import { afterEach, beforeEach, expect, it, vi } from "vitest";
import webPush from "web-push";
import { createECDH, randomBytes } from "node:crypto";
const mocks = vi.hoisted(() => ({ local: vi.fn(), block: vi.fn(), writable: vi.fn(),
  admin: vi.fn(), rpc: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/pc-local-runtime", () => ({ getPcLocalRuntime: mocks.local }));
vi.mock("@/lib/pc-backup-status", () => ({ pcAppWriteProtectionResponse: async () => {
  const blocked = await mocks.block(); if (blocked) return blocked;
  return await mocks.writable() ? null : new Response("backup unavailable", { status: 503 });
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("LOCAL_WEB_PUSH_ENABLED", "true"); vi.stubEnv("CRON_SECRET", "synthetic-cron");
  const keys = webPush.generateVAPIDKeys();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", keys.publicKey); vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
  vi.stubEnv("VAPID_SUBJECT", "mailto:synthetic@example.invalid");
  mocks.local.mockReturnValue({ restUrl: "http://127.0.0.1:18002", authUrl: "http://127.0.0.1:18001" });
  mocks.block.mockResolvedValue(null); mocks.writable.mockResolvedValue(true);
  mocks.admin.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: [], error: null });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (authorization = "Bearer synthetic-cron", extra = {}) => new Request("http://127.0.0.1:3000/api/push/deliver", {
  method: "POST", headers: { authorization, ...extra }, body: "{}" });
it("cloud/default, invalid local runtime and unauthenticated callers cannot access the outbox", async () => {
  vi.stubEnv("LOCAL_WEB_PUSH_ENABLED", "false"); expect((await POST(request())).status).toBe(404);
  vi.stubEnv("LOCAL_WEB_PUSH_ENABLED", "true"); mocks.local.mockReturnValue(undefined);
  expect((await POST(request())).status).toBe(503); mocks.local.mockReturnValue({});
  expect((await POST(request("Bearer wrong"))).status).toBe(401);
  expect((await POST(request("Bearer synthetic-cron", { "x-tuat-mirror": "1" }))).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("read-only standby does no claim, subscription cleanup or outbound delivery", async () => {
  mocks.block.mockResolvedValue(new Response("read-only", { status: 503 }));
  expect((await POST(request())).status).toBe(503);
  expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("misconfigured VAPID fails before claiming; empty queue succeeds with safe counts", async () => {
  vi.stubEnv("VAPID_PRIVATE_KEY", "bad"); expect((await POST(request())).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
  vi.stubEnv("VAPID_PRIVATE_KEY", webPush.generateVAPIDKeys().privateKey);
  expect((await POST(request())).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("a valid empty queue is observed once and a claim failure is never changed to no subscriptions", async () => {
  const result = await POST(request()); expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true, processed: 0, sent: 0, dropped: 0, failed: 0, uncertain: 0 });
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith("claim_local_push");
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "private synthetic error" } });
  const failed = await POST(request()); expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("private synthetic"); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("a claimed device test selects its database owner/device, sends encrypted bytes once and records completion", async () => {
  const owner = "00000000-0000-4000-8000-000000000111", device = "00000000-0000-4000-8000-000000000112";
  const delivery = "00000000-0000-4000-8000-000000000113";
  const receiver = createECDH("prime256v1"); receiver.generateKeys();
  const rows = [{ id: device, user_id: owner, endpoint: "https://fcm.googleapis.com/synthetic",
    p256dh: receiver.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") }];
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  query.range.mockReturnValue(query);
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: vi.fn(() => query) });
  mocks.rpc.mockResolvedValueOnce({ data: [{ id: delivery, record: { id: delivery, user_id: owner,
    type: "test", subscription_id: device, reference_type: null, reference_id: null } }], error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  mocks.fetch.mockResolvedValue(new Response(null, { status: 201 }));
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, processed: 1, sent: 1, failed: 0, uncertain: 0 });
  expect(query.eq).toHaveBeenCalledWith("user_id", owner); expect(query.eq).toHaveBeenCalledWith("id", device);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "POST" });
  expect(mocks.rpc).toHaveBeenLastCalledWith("complete_local_push", {
    delivery_id: delivery, outcome: "delivered", counts: { sent: 1, dropped: 0, failed: 0, uncertain: 0 } });
});
