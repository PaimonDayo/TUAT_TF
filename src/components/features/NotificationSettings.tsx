"use client";

import { useState, useEffect } from "react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";
import {
  reconcilePushSubscription,
  registerPushSubscription,
  urlBase64ToUint8Array,
} from "@/lib/push";

export function NotificationSettings({
  profileId,
  initialComment,
  initialNotice,
}: {
  profileId: string;
  initialComment: boolean;
  initialNotice: boolean;
}) {
  const { showToast } = useToast();
  const [comment, setComment] = useState(initialComment);
  const [notice, setNotice] = useState(initialNotice);
  
  const [pushStatus, setPushStatus] = useState<'unsupported' | 'default' | 'granted' | 'denied'>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    if (typeof window !== "undefined" && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
      // ブラウザAPIの初期状態をマウント後に同期する。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPushStatus(Notification.permission);
      
      // 端末の購読とサーバー側の登録がそろって初めて「オン」と表示する。
      // 端末に購読が残っていてもサーバー側の登録が消えていると通知は届かないので、
      // ここで登録し直し、直せなかったときは「オフ」と正直に表示する。
      const client = createClient();
      reconcilePushSubscription(client).then((result) => {
        setIsSubscribed(result === "registered" || result === "resubscribed");
      });
    }

    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua);
    setIsIos(isIosDevice);
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
  }, []);

  const handleChange = async (field: "notify_comment" | "notify_notice", value: boolean, setter: (val: boolean) => void) => {
    setter(value);
    const result = await safeUpdate(supabase, "profiles", { [field]: value }, { id: profileId });
    if (!result.ok) {
      setter(!value);
      showToast(safeUpdateMessage(result.reason));
    }
  };

  const handleSubscribe = async () => {
    setIsProcessing(true);
    try {
      if (pushStatus === 'default') {
        const permission = await Notification.requestPermission();
        setPushStatus(permission);
        if (permission !== 'granted') return;
      }
      if (pushStatus === 'denied') {
        showToast('ブラウザの設定から通知を許可してください');
        return;
      }
      
      const reg = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        showToast('通知をオンにできませんでした');
        return;
      }

      // 端末に購読が残っていれば、鍵の確認とサーバー登録まで自己修復でそろえる。
      const healed = await reconcilePushSubscription(supabase);
      if (healed === "registered" || healed === "resubscribed") {
        setIsSubscribed(true);
        setPushStatus('granted');
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // サーバーへの登録まで成功したときだけ「オン」にする。
      const registered = await registerPushSubscription(supabase, subscription);
      if (!registered) {
        showToast('通知をオンにできませんでした');
        return;
      }
      
      setIsSubscribed(true);
      setPushStatus('granted');
    } catch (e) {
      console.error(e);
      showToast('通知をオンにできませんでした');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnsubscribe = async () => {
    setIsProcessing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        const subData = subscription.toJSON();
        if (subData.endpoint) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', subData.endpoint);
        }
      }
      setIsSubscribed(false);
    } catch (e) {
      console.error(e);
      showToast('通知をオフにできませんでした');
    } finally {
      setIsProcessing(false);
    }
  };

  // 実際にこの端末へ通知を1件送ってみる。届いたかどうかは端末の画面で確認してもらう。
  const handleTestPush = async () => {
    if (isTesting) return;
    setIsTesting(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      showToast(data.message ?? 'テスト通知を送れませんでした。時間をおいてお試しください');
    } catch (e) {
      console.error(e);
      showToast('テスト通知を送れませんでした。時間をおいてお試しください');
    } finally {
      setIsTesting(false);
    }
  };

  // 通知ON/OFFの本体。OFF→ONで「通知を許可しますか？」を出して購読、ON→OFFで解除。
  const handleToggleNotifications = async () => {
    if (isProcessing) return;
    if (isSubscribed) {
      await handleUnsubscribe();
    } else {
      await handleSubscribe();
    }
  };

  return (
    <>
      {pushStatus === "unsupported" ? (
        <p className="px-4 py-3 text-[13px] text-muted2">この端末は通知に対応していません。</p>
      ) : isIos && !isStandalone ? (
        <p className="px-4 py-3 text-[13px] leading-relaxed text-muted2">
          iPhoneで通知を受け取るには、ブラウザの共有メニューから「ホーム画面に追加」をしてから、追加したアプリを開いて設定してください。
        </p>
      ) : (
        <>
          <Toggle
            variant="row"
            label="通知を受け取る"
            description={
              pushStatus === "denied"
                ? "ブラウザの設定で通知がブロックされています"
                : "この端末に通知を表示します"
            }
            checked={isSubscribed}
            onChange={handleToggleNotifications}
          />

          {/* 何を通知するか（通知ON時のみ） */}
          {isSubscribed && (
            <div className="divide-y divide-separator/70 border-t border-separator/70">
              <p className="px-4 pb-1 pt-3 text-micro text-muted2">受け取る種類</p>
              <Toggle
                variant="row"
                label="コメント"
                description="自分の投稿へのコメントと、参加中スレッドへの返信を通知します。"
                checked={comment}
                onChange={() => handleChange("notify_comment", !comment, setComment)}
              />
              <Toggle
                variant="row"
                label="お知らせ"
                description="新しいお知らせが投稿されたときに通知します。"
                checked={notice}
                onChange={() => handleChange("notify_notice", !notice, setNotice)}
              />
            </div>
          )}

          {/* 届くかどうかをその場で確かめる（「通知が来ない」相談の切り分け用） */}
          {isSubscribed && (
            <div className="space-y-1.5 px-4 py-3">
              <Button variant="outline" size="sm" onClick={handleTestPush} disabled={isTesting}>
                {isTesting ? "送信中…" : "通知が届くか試す"}
              </Button>
              <p className="text-micro text-muted2">この端末に通知を1件送って確かめます。</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
