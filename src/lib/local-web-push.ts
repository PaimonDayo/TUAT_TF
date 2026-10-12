import webPush from "web-push";
import { createECDH } from "node:crypto";
import { isAllowedPushEndpoint } from "../../supabase/functions/send-web-push/endpoint";

export type PushRecord = { id: string; user_id: string; type: string;
  reference_type: string | null; reference_id: string | null; subscription_id?: string | null };
export type LocalPushItem = { id: string; record: PushRecord };
export type LocalPushSubscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
export type LocalPushConfig = { subject: string; publicKey: string; privateKey: string };
export type PushOutcome = "delivered" | "failed" | "uncertain";
export type PushCounts = { sent: number; dropped: number; failed: number; uncertain: number };
export type LocalPushStore = {
  claim(): Promise<LocalPushItem[]>;
  subscriptions(record: PushRecord): Promise<LocalPushSubscription[]>;
  drop(subscription: LocalPushSubscription): Promise<boolean>;
  complete(id: string, outcome: PushOutcome, counts: PushCounts): Promise<void>;
};
export class LocalPushReadOnly extends Error {}
export class PushPreparationFailed extends Error {}
export class PushResultUnknown extends Error {}

/** Same notification text and permalinks as the existing send-web-push Edge Function. */
export function localPushPayload(record: PushRecord): string {
  let title = "新しいお知らせ", body = "新しい通知があります", url = "/notices";
  if (record.type === "comment") {
    title = "新しいコメント"; body = "あなたの投稿にコメントがつきました";
    if ((record.reference_type === "record" || record.reference_type === "tweet") && record.reference_id) {
      url = `/timeline/${record.reference_type}/${record.reference_id}`;
    }
  } else if (record.type === "notice") body = "お知らせが投稿されました";
  else if (record.type === "schedule_update") {
    title = "予定が更新されました"; body = "アプリで最新の予定を確認してください"; url = "/schedule";
  } else if (record.type === "test") {
    title = "通知テスト"; body = "この通知が見えていれば、通知は届いています"; url = "/mypage";
  } else if (record.type === "thread_reply") {
    title = "スレッドに新しいメッセージ"; body = "参加中のスレッドにメッセージが届きました";
    url = record.reference_id ? `/notes/threads/${record.reference_id}` : "/notices#notifications";
  } else if (record.type === "mention") {
    title = "メンションされました"; body = "つぶやきまたはストーリーであなたがメンションされました";
    url = record.reference_id ? `/timeline/tweet/${record.reference_id}` : "/notices#notifications";
  }
  return JSON.stringify({ title, body, data: { url, notificationId: record.id } });
}

/** Library-owned encryption/VAPID; bounded HTTP with no redirect or automatic retry. */
export function localPushSender(config: LocalPushConfig, fetchRequest: typeof fetch = fetch) {
  // Reject invalid/mismatched server keys before claiming any delivery or removing subscriptions.
  try {
    webPush.getVapidHeaders("https://fcm.googleapis.com", config.subject, config.publicKey, config.privateKey, "aes128gcm");
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(Buffer.from(config.privateKey, "base64url"));
    if (!pair.getPublicKey().equals(Buffer.from(config.publicKey, "base64url"))) throw new Error();
  } catch { throw new PushPreparationFailed(); }
  return async (subscription: LocalPushSubscription, payload: string): Promise<number> => {
    if (!isAllowedPushEndpoint(subscription.endpoint)) throw new PushPreparationFailed();
    let details;
    try {
      details = webPush.generateRequestDetails({ endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload,
      { vapidDetails: config, TTL: 2419200, contentEncoding: "aes128gcm" });
    } catch { throw new PushPreparationFailed(); }
    try {
      const response = await fetchRequest(details.endpoint, { method: "POST", redirect: "error",
        signal: AbortSignal.timeout(10000), cache: "no-store",
        headers: Object.fromEntries(Object.entries(details.headers).map(([name, value]) => [name, String(value)])),
        body: new Uint8Array(details.body) });
      // Do not await tee cancellation: an unread other branch can prevent it from settling.
      void response.body?.cancel().catch(() => {});
      return response.status;
    } catch { throw new PushResultUnknown(); }
  };
}

/** Claimed entries never return to pending, including a crash before any HTTP response. */
export async function deliverLocalPush({ store, writable, send }: {
  store: LocalPushStore; writable: () => Promise<boolean>;
  send: (subscription: LocalPushSubscription, payload: string) => Promise<number>;
}) {
  const assertWritable = async () => { if (!await writable()) throw new LocalPushReadOnly(); };
  await assertWritable();
  const items = await store.claim();
  const total: PushCounts = { sent: 0, dropped: 0, failed: 0, uncertain: 0 };
  for (const item of items) {
    await assertWritable();
    const subscriptions = await store.subscriptions(item.record);
    const counts: PushCounts = { sent: 0, dropped: 0, failed: 0, uncertain: 0 };
    for (const subscription of subscriptions) {
      await assertWritable();
      if (subscription.user_id !== item.record.user_id ||
          (item.record.type === "test" && item.record.subscription_id && subscription.id !== item.record.subscription_id) ||
          !isAllowedPushEndpoint(subscription.endpoint)) { counts.failed++; continue; }
      let status;
      try { status = await send(subscription, localPushPayload(item.record)); }
      catch (error) {
        if (error instanceof PushPreparationFailed) counts.failed++;
        else counts.uncertain++;
        continue;
      }
      if (status >= 200 && status < 300) counts.sent++;
      else if ([403, 404, 410].includes(status)) {
        await assertWritable();
        if (await store.drop(subscription)) counts.dropped++; else counts.failed++;
      } else counts.failed++;
    }
    await assertWritable();
    await store.complete(item.id, counts.uncertain ? "uncertain" : counts.failed ? "failed" : "delivered", counts);
    for (const name of ["sent", "dropped", "failed", "uncertain"] as const) total[name] += counts[name];
  }
  return { ok: total.failed === 0 && total.uncertain === 0, processed: items.length, ...total };
}
