import { timingSafeEqualString } from "@/lib/timing-safe";

/** Vercel owns the schedule while the managed database's cron is suspended. */
export async function forwardPcCron(request: Request, handler: (request: Request) => Promise<Response>) {
  if (process.env.PC_BACKEND_ENABLED !== "true") return new Response(null, { status: 204 });
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqualString(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "認証が必要です" }, { status: 401 });
  }
  const syncSecret = process.env.SHEET_SYNC_SECRET;
  if (!syncSecret) return Response.json({ error: "同期設定を確認してください" }, { status: 503 });
  return handler(new Request(request.url, { method: "POST", headers: { authorization: `Bearer ${syncSecret}`, "content-type": "application/json" }, body: "{}" }));
}
