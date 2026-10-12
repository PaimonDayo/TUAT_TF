import { afterEach, describe, expect, it, vi } from "vitest";
import { createECDH, randomBytes, type ECDH } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import webPush from "web-push";
import { deliverLocalPush, localPushPayload, localPushSender, LocalPushReadOnly,
  PushPreparationFailed, PushResultUnknown, type LocalPushItem, type LocalPushStore } from "./local-web-push";

const user = "00000000-0000-4000-8000-000000000001";
const item: LocalPushItem = { id: "00000000-0000-4000-8000-000000000002", record: {
  id: "00000000-0000-4000-8000-000000000003", user_id: user, type: "comment",
  reference_type: "tweet", reference_id: "00000000-0000-4000-8000-000000000004" } };
const sub = { id: "00000000-0000-4000-8000-000000000005", user_id: user,
  endpoint: "https://fcm.googleapis.com/synthetic", p256dh: "fake", auth: "fake" };
function store(rows = [sub]): LocalPushStore {
  return { claim: vi.fn(async () => [item]), subscriptions: vi.fn(async () => rows),
    drop: vi.fn(async () => true), complete: vi.fn(async () => {}) };
}
afterEach(() => vi.restoreAllMocks());

describe("local delivery acceptance", () => {
  it("preserves Edge Function notification identities and permalinks", () => {
    expect(JSON.parse(localPushPayload(item.record))).toMatchObject({ title: "新しいコメント",
      data: { url: `/timeline/tweet/${item.record.reference_id}`, notificationId: item.record.id } });
    expect(JSON.parse(localPushPayload({ ...item.record, type: "test" })).data.url).toBe("/mypage");
    expect(JSON.parse(localPushPayload({ ...item.record, type: "thread_reply" })).data.url)
      .toBe(`/notes/threads/${item.record.reference_id}`);
  });
  it("a read-only primary cannot claim, deliver, delete or complete", async () => {
    const database = store(), send = vi.fn();
    await expect(deliverLocalPush({ store: database, writable: async () => false, send })).rejects.toBeInstanceOf(LocalPushReadOnly);
    expect(database.claim).not.toHaveBeenCalled(); expect(database.drop).not.toHaveBeenCalled();
    expect(database.complete).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("expired/key-invalid subscriptions are removed; delete failure is not success", async () => {
    for (const status of [403, 404, 410]) {
      const database = store();
      expect(await deliverLocalPush({ store: database, writable: async () => true, send: async () => status }))
        .toMatchObject({ ok: true, sent: 0, dropped: 1, failed: 0 });
      expect(database.drop).toHaveBeenCalledWith(sub);
    }
    const database = store(); database.drop = vi.fn(async () => false);
    expect(await deliverLocalPush({ store: database, writable: async () => true, send: async () => 410 }))
      .toMatchObject({ ok: false, dropped: 0, failed: 1 });
  });
  it("cannot send another user's subscription, another test device or an untrusted host", async () => {
    const database = store([{ ...sub, user_id: "another" }, { ...sub, endpoint: "https://127.0.0.1/private" }]);
    const send = vi.fn(async () => 201);
    expect(await deliverLocalPush({ store: database, writable: async () => true, send })).toMatchObject({ failed: 2, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    database.claim = vi.fn(async () => [{ ...item, record: { ...item.record, type: "test", subscription_id: "another-device" } }]);
    database.subscriptions = vi.fn(async () => [sub]);
    expect(await deliverLocalPush({ store: database, writable: async () => true, send })).toMatchObject({ failed: 1 });
    expect(send).not.toHaveBeenCalled();
  });
  it("a result lost after sending stays uncertain, with exactly one request and no deletion", async () => {
    const database = store(), send = vi.fn(async () => { throw new PushResultUnknown(); });
    expect(await deliverLocalPush({ store: database, writable: async () => true, send }))
      .toMatchObject({ ok: false, uncertain: 1, failed: 0, sent: 0 });
    expect(send).toHaveBeenCalledTimes(1); expect(database.drop).not.toHaveBeenCalled();
    expect(database.complete).toHaveBeenCalledWith(item.id, "uncertain", expect.objectContaining({ uncertain: 1 }));
  });
  it("read-only activation after delivery prevents cleanup/completion writes", async () => {
    const database = store(); let writable = true;
    await expect(deliverLocalPush({ store: database, writable: async () => writable,
      send: async () => { writable = false; return 410; } })).rejects.toBeInstanceOf(LocalPushReadOnly);
    expect(database.drop).not.toHaveBeenCalled(); expect(database.complete).not.toHaveBeenCalled();
  });
  it("library encryption reaches only a synthetic loopback endpoint and can be decrypted by the fake receiver", async () => {
    const receiver = createECDH("prime256v1"); receiver.generateKeys();
    const auth = randomBytes(16), vapid = webPush.generateVAPIDKeys();
    const config = { ...vapid, subject: "mailto:synthetic@example.invalid" };
    const subscription = { ...sub, p256dh: receiver.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
    const decrypt = (createRequire(import.meta.url)("http_ece") as {
      decrypt(body: Buffer, options: { privateKey: ECDH; authSecret: Buffer; version: string }): Buffer;
    }).decrypt;
    let received = "", requests = 0, receiverFailure: unknown;
    const server = createServer(async (request, response) => {
      try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
      expect(request.headers["content-encoding"]).toBe("aes128gcm");
      expect(request.headers.authorization).toMatch(/^vapid t=/);
      received = decrypt(Buffer.concat(chunks), { privateKey: receiver, authSecret: auth, version: "aes128gcm" }).toString();
      requests++; response.writeHead(201); response.end();
      } catch (error) { receiverFailure = error; response.writeHead(503); response.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error();
      const fakeFetch: typeof fetch = (url, init) => {
        expect(url).toBe(sub.endpoint); expect(init?.redirect).toBe("error");
        return fetch(`http://127.0.0.1:${address.port}/synthetic`, init);
      };
      const sender = localPushSender(config, fakeFetch);
      expect(await sender(subscription, localPushPayload(item.record))).toBe(201);
      expect(receiverFailure).toBeUndefined();
      expect(JSON.parse(received).data.notificationId).toBe(item.record.id); expect(requests).toBe(1);
      expect(() => localPushSender({ ...config, privateKey: webPush.generateVAPIDKeys().privateKey }, fakeFetch))
        .toThrow(PushPreparationFailed);
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("malformed keys fail before delivery; socket failure is unknown and never retries", async () => {
    const config = { ...webPush.generateVAPIDKeys(), subject: "mailto:synthetic@example.invalid" };
    const fetchRequest = vi.fn(async () => { throw new Error("synthetic transport lost"); });
    const sender = localPushSender(config, fetchRequest);
    await expect(sender(sub, "fake")).rejects.toBeInstanceOf(PushPreparationFailed);
    expect(fetchRequest).not.toHaveBeenCalled();
    const receiver = createECDH("prime256v1"); receiver.generateKeys();
    await expect(sender({ ...sub, p256dh: receiver.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") }, "fake"))
      .rejects.toBeInstanceOf(PushResultUnknown);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });
});
