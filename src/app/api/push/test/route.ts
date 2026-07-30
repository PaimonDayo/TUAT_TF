import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type TestPushResult = {
  sent?: boolean;
  reason?: string;
  subscriptions?: number;
};

/**
 * 「通知が届くか試す」ボタンの受け口。ログイン中の本人の端末にだけテスト通知を送る。
 *
 * 送信そのものは DB 関数 send_test_push() が Vault の秘密で Edge Function を呼ぶ形で行う。
 * VAPID の秘密鍵をこのアプリ側へ持ち出さないため、ここでは配信結果までは分からない
 * （届いたかどうかは部員本人が端末で確認する）。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "ログインし直してからお試しください" },
      { status: 401 },
    );
  }

  const { data, error } = await supabase.rpc("send_test_push");
  if (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, message: "テスト通知を送れませんでした。時間をおいてお試しください" },
      { status: 500 },
    );
  }

  const result = (data ?? {}) as TestPushResult;
  if (!result.sent) {
    if (result.reason === "no_subscription") {
      return NextResponse.json({
        ok: false,
        message: "この端末は通知を受け取る設定になっていません。「通知を受け取る」をオフにしてから、もう一度オンにしてください",
      });
    }
    return NextResponse.json({
      ok: false,
      message: "いまはテスト通知を送れません。部のアプリ担当者に連絡してください",
    });
  }

  return NextResponse.json({
    ok: true,
    message: "テスト通知を送りました。数秒たっても届かないときは、通知をオフにしてからもう一度オンにしてください",
  });
}
