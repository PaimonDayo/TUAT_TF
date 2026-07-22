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
    } else if (notification.type === 'notice') {
      title = "新しいお知らせ";
      bodyText = "お知らせが投稿されました";
    } else if (notification.type === 'schedule_update') {
      title = "予定が更新されました";
      bodyText = "アプリで最新の予定を確認してください";
      url = "/schedule";
    } else if (notification.type === 'thread_reply') {
      title = "スレッドに新しい返信";
      bodyText = "参加中のスレッドに返信がありました";
      url = notification.reference_id ? `/notes/threads/${notification.reference_id}` : "/notices#notifications";
    }

    const payload = JSON.stringify({
      title,
      body: bodyText,
      data: { url }
    });

    const sendPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        }
      };

      try {
        await webPush.sendNotification(pushSubscription, payload);
      } catch (err: unknown) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : undefined;
        if (statusCode === 410 || statusCode === 404) {
          await supabaseClient.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error("Error sending push:", err);
        }
      }
    });

    await Promise.all(sendPromises);

    return new Response(JSON.stringify({ message: "Pushes sent" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Push notification failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
