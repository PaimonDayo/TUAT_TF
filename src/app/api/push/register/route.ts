import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Service Worker の pushsubscriptionchange から呼ばれ、作り直された購読を登録する。
 * 認可はログイン中のセッションだけ（RPC も auth.uid() で本人の行しか触れない）。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "購読情報が足りません" }, { status: 400 });
  }

  const { error } = await supabase.rpc("register_push_subscription", {
    subscription_endpoint: endpoint,
    subscription_p256dh: p256dh,
    subscription_auth: auth,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
