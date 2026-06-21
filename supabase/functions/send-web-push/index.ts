import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import webPush from "https://esm.sh/web-push@3.6.6";

const vapidPublicKey = Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY') || Deno.env.get('VAPID_PUBLIC_KEY');
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const vapidSubject = Deno.env.get('VAPID_SUBJECT');

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

serve(async (req) => {
  try {
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
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
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

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
