import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import webPush from "https://esm.sh/web-push@3.6.6";

const vapidPublicKey = Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY') || Deno.env.get('VAPID_PUBLIC_KEY');
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const vapidSubject = Deno.env.get('VAPID_SUBJECT');
const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}

async function authorized(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-push-webhook-secret');
  if (!webhookSecret || !provided) return false;
  const [expectedDigest, providedDigest] = await Promise.all([
    digest(webhookSecret),
    digest(provided),
  ]);
  return expectedDigest.every((byte, index) => byte === providedDigest[index]);
}


if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

serve(async (req) => {
  try {
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: 'Push webhook secret is not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!(await authorized(req))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error('VAPID keys are not configured');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    
    if (body.type !== 'INSERT' || body.table !== 'notifications') {
      return new Response(JSON.stringify({ message: "Not an insert event on notifications" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const notification = body.record;
    
    const { data: subscriptions, error } = await supabaseClient
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', notification.user_id);

    if (error) {
      throw error;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No subscriptions found" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let title = "新しいお知らせ";
    let bodyText = "新しい通知があります";
    let url = "/notices";

    if (notification.type === 'comment') {
      title = "新しいコメント";
      bodyText = "あなたの投稿にコメントがつきました";
      // コメント通知の reference_type/reference_id は投稿そのもの（record|tweet + 投稿ID）。
      // 返信を開いた状態のパーマリンクへ直接飛ばす。
      url =
        (notification.reference_type === 'record' || notification.reference_type === 'tweet') &&
        notification.reference_id
          ? `/timeline/${notification.reference_type}/${notification.reference_id}`
          : "/notices";
    } else if (notification.type === 'notice') {
      title = "新しいお知らせ";
      bodyText = "お知らせが投稿されました";
    } else if (notification.type === 'schedule_update') {
      title = "予定が更新されました";
      bodyText = "アプリで最新の予定を確認してください";
      url = "/schedule";
    } else if (notification.type === 'test') {
      // 「通知が届くか試す」ボタン（send_test_push）から届く確認用の1件。
      title = "通知テスト";
      bodyText = "この通知が見えていれば、通知は届いています";
      url = "/mypage";
    } else if (notification.type === 'thread_reply') {
      title = "スレッドに新しいメッセージ";
      bodyText = "参加中のスレッドにメッセージが届きました";
      url = notification.reference_id ? `/notes/threads/${notification.reference_id}` : "/notices#notifications";
    } else if (notification.type === 'mention') {
      title = "メンションされました";
      bodyText = "つぶやきまたはストーリーであなたがメンションされました";
      url = notification.reference_id ? `/timeline/tweet/${notification.reference_id}` : "/notices#notifications";

    }
    const payload = JSON.stringify({
      title,
      body: bodyText,
      data: { url }
    });
    const results = await Promise.all(subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        }
      };

      try {
        await webPush.sendNotification(pushSubscription, payload);
        return { sent: true, dropped: false };
      } catch (err: unknown) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : undefined;
        const body =
          typeof err === "object" && err !== null && "body" in err
            ? String((err as { body: unknown }).body)
            : "";
        // 配信先が消えた(410/404)ものに加え、いまの鍵では二度と送れない購読も外す。
        // 鍵を入れ替えると、古い鍵で作られた購読は 403 や VapidPkHashMismatch を返し続け、
        // 通知のたびに必ず失敗する。残しておいても復活しないので消してよい
        // （その端末はアプリを開いた時点で購読し直され、新しい行が入る）。
        const staleKey =
          statusCode === 403 || body.includes("VapidPkHashMismatch");
        if (statusCode === 410 || statusCode === 404 || staleKey) {
          await supabaseClient.from('push_subscriptions').delete().eq('id', sub.id);
          return { sent: false, dropped: true };
        }
        console.error("Error sending push:", statusCode, body, err);
        return { sent: false, dropped: false };
      }
    }));

    const sent = results.filter((r) => r.sent).length;
    const dropped = results.filter((r) => r.dropped).length;
    const failed = results.length - sent - dropped;
    // 1件も送れていないのに 200 を返すと、配信が壊れていても気づけない。
    // 呼び出し側（pg_net の記録）に結果がそのまま残るよう、内訳を返す。
    return new Response(
      JSON.stringify({ message: "Pushes sent", sent, dropped, failed }),
      {
        status: failed > 0 && sent === 0 ? 502 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Push notification failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
