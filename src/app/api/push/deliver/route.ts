import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPcLocalRuntime } from "@/lib/pc-local-runtime";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { pcAppWriteProtectionResponse } from "@/lib/pc-backup-status";
import { deliverLocalPush, LocalPushReadOnly, localPushSender,
  type LocalPushItem, type LocalPushSubscription, type LocalPushStore } from "@/lib/local-web-push";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  if (process.env.LOCAL_WEB_PUSH_ENABLED !== "true") return Response.json({ error: "Not enabled" }, { status: 404, headers });
  let local;
  try { local = getPcLocalRuntime(); } catch { /* Invalid local configuration fails closed. */ }
  if (!local) return Response.json({ error: "Local runtime required" }, { status: 503, headers });
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqualString(request.headers.get("authorization") ?? "", `Bearer ${secret}`) ||
      request.headers.has("x-tuat-mirror")) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const stopped = await pcAppWriteProtectionResponse();
  if (stopped) return stopped;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return Response.json({ error: "Push not configured" }, { status: 503, headers });
  const admin = createAdminClient() as SupabaseClient;
  const store: LocalPushStore = {
    async claim() {
      const { data, error } = await admin.rpc("claim_local_push");
      if (error || !Array.isArray(data)) throw new Error("Claim failed");
      return data as LocalPushItem[];
    },
    async subscriptions(record) {
      const result: LocalPushSubscription[] = [];
      for (let start = 0; ; start += 500) {
        let query = admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth")
          .eq("user_id", record.user_id).order("id").range(start, start + 499);
        if (record.type === "test" && record.subscription_id) query = query.eq("id", record.subscription_id);
        const { data, error } = await query;
        if (error || !data) throw new Error("Subscriptions unavailable");
        result.push(...data as LocalPushSubscription[]);
        if (data.length < 500) return result;
      }
    },
    async drop(subscription) {
      const { data, error } = await admin.from("push_subscriptions").delete().eq("id", subscription.id)
        .eq("user_id", subscription.user_id).eq("endpoint", subscription.endpoint)
        .eq("p256dh", subscription.p256dh).eq("auth", subscription.auth).select("id");
      return !error && data?.length === 1;
    },
    async complete(id, outcome, counts) {
      const { data, error } = await admin.rpc("complete_local_push", { delivery_id: id, outcome, counts });
      if (error || data !== true) throw new Error("Completion not recorded");
    },
  };
  try {
    const result = await deliverLocalPush({ store, writable: async () => !(await pcAppWriteProtectionResponse()),
      send: localPushSender({ publicKey, privateKey, subject }) });
    return Response.json(result, { status: result.ok ? 200 : 502, headers });
  } catch (error) {
    if (error instanceof LocalPushReadOnly) {
      return Response.json({ error: "BACKUP_READ_ONLY" }, { status: 503, headers });
    }
    // Claimed items stay claimed/uncertain. Neither Next nor Jobs retries an unknown result.
    return Response.json({ error: "Push delivery unavailable" }, { status: 503, headers });
  }
}
