import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** VAPID公開鍵（base64url）を Push API が要求するバイト列へ変換する。 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * 端末に残っている購読が、いまアプリが配っている公開鍵で作られたものかを調べる。
 * 鍵が入れ替わると、購読自体は生きているのに配信だけが届かなくなるため、
 * バイト列そのものを突き合わせる。
 */
export function applicationServerKeyMatches(
  applicationServerKey: ArrayBuffer | null | undefined,
  vapidPublicKey: string | null | undefined,
): boolean {
  if (!applicationServerKey || !vapidPublicKey) return false;
  let expected: Uint8Array;
  try {
    expected = urlBase64ToUint8Array(vapidPublicKey);
  } catch {
    return false;
  }
  const actual = new Uint8Array(applicationServerKey);
  if (actual.length === 0 || actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

export type PushReconcileAction = "unsupported" | "skip" | "register" | "resubscribe";

/**
 * いまの状態でどう直すべきかだけを決める（副作用なし・テスト対象）。
 * - 端末に購読が無いときは何もしない。通知を自分でオフにした人を勝手に戻さないため。
 * - 通知が許可されていないときも何もしない。許可のダイアログを勝手に出さないため。
 */
export function decideReconcileAction(state: {
  supported: boolean;
  permission: string;
  vapidPublicKey?: string | null;
  hasSubscription: boolean;
  keyMatches: boolean;
}): PushReconcileAction {
  if (!state.supported) return "unsupported";
  if (state.permission !== "granted") return "skip";
  if (!state.vapidPublicKey) return "skip";
  if (!state.hasSubscription) return "skip";
  return state.keyMatches ? "register" : "resubscribe";
}

export type PushReconcileResult =
  | "unsupported"
  | "skipped"
  | "registered"
  | "resubscribed"
  | "failed";

/** この端末が Web Push に対応しているか。 */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** 端末の購読をサーバーへ登録し直す（同じ端末なら何度呼んでも増えない）。 */
export async function registerPushSubscription(
  supabase: Client,
  subscription: PushSubscription,
): Promise<boolean> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  const { error } = await supabase.rpc("register_push_subscription", {
    subscription_endpoint: json.endpoint,
    subscription_p256dh: json.keys.p256dh,
    subscription_auth: json.keys.auth,
  });
  if (error) {
    console.error(error);
    return false;
  }
  return true;
}

/**
 * 端末の購読とサーバー側の登録がずれていたら、その場で直す。
 *
 * サーバー側の登録は、配信が拒否されたとき（410/404）に消える。端末には購読が
 * 残るので設定は「オン」に見えるのに、通知だけが1件も届かなくなる。ここで毎回
 * 登録し直すことで、部員が何もしなくても元に戻る。
 *
 * 画面には何も出さず、例外も外へ投げない。通知の許可も求めない。
 */
export async function reconcilePushSubscription(
  supabase: Client,
): Promise<PushReconcileResult> {
  try {
    const supported = isPushSupported();
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!supported) return "unsupported";
    if (Notification.permission !== "granted" || !vapidPublicKey) return "skipped";

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    const action = decideReconcileAction({
      supported,
      permission: Notification.permission,
      vapidPublicKey,
      hasSubscription: Boolean(subscription),
      keyMatches: subscription
        ? applicationServerKeyMatches(subscription.options.applicationServerKey, vapidPublicKey)
        : false,
    });

    if (action === "unsupported") return "unsupported";
    if (action === "skip") return "skipped";

    let resubscribed = false;
    if (action === "resubscribe" && subscription) {
      // 鍵が変わっている購読は、そのままでは二度と配信されない。作り直す。
      // 古い行は消さない（配信側が410を受けたときに片付く）。
      await subscription.unsubscribe().catch(() => false);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      resubscribed = true;
    }

    if (!subscription) return "skipped";
    const ok = await registerPushSubscription(supabase, subscription);
    if (!ok) return "failed";
    return resubscribed ? "resubscribed" : "registered";
  } catch (e) {
    console.error(e);
    return "failed";
  }
}
