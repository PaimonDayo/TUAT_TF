import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function loginAccessStatus(client: SupabaseClient<Database>): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    const { data, error } = await client.rpc("login_access_allowed");
    if (error?.code === "PT403") return "denied";
    if (error) return "unavailable";
    return data === true ? "allowed" : "denied";
  } catch { return "unavailable"; }
}

/** DBを読まずR2を直接操作する入口でも、検証済み本人の許可を確認する。 */
export async function loginAccessResponse(client: SupabaseClient<Database>): Promise<Response | null> {
  const status = await loginAccessStatus(client);
  if (status === "allowed") return null;
  return Response.json({ error: status === "denied"
    ? "このアカウントのログインは許可されていません"
    : "ログインの許可を確認できませんでした。時間をおいてお試しください。" }, {
    status: status === "denied" ? 403 : 503, headers: { "Cache-Control": "private, no-store" },
  });
}
