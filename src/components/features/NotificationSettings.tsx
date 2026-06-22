"use client";

import { useState, useEffect } from "react";
import { Toggle } from "@/components/ui/toggle";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export function NotificationSettings({
  profileId,
  initialComment,
  initialNotice,
}: {
  profileId: string;
  initialComment: boolean;
  initialNotice: boolean;
}) {
  const [comment, setComment] = useState(initialComment);
  const [notice, setNotice] = useState(initialNotice);
  
  const [pushStatus, setPushStatus] = useState<'unsupported' | 'default' | 'granted' | 'denied'>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    if (typeof window !== "undefined" && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
      setPushStatus(Notification.permission);
      
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          setIsSubscribed(!!sub);
        });
      });
    }

    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua);
    setIsIos(isIosDevice);
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);
  }, []);

  const handleChange = async (field: "notify_comment" | "notify_notice", value: boolean, setter: (val: boolean) => void) => {
    setter(value);
    const result = await safeUpdate(supabase, "profiles", { [field]: value }, { id: profileId });
    if (!result.ok) {
      setter(!value);
      alert(safeUpdateMessage(result.reason));
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
        alert('ブラウザの設定から通知を許可してください');
        return;
      }
      
      const reg = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        alert('VAPID公開鍵が設定されていません');
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      const subData = subscription.toJSON();
      
      const { error } = await supabase.from('push_subscriptions').insert({
        user_id: profileId,
        endpoint: subData.endpoint,
        p256dh: subData.keys?.p256dh,
        auth: subData.keys?.auth
      });

      if (error && error.code !== '23505') {
        console.error(error);
        alert('登録に失敗しました');
        return;
      }
      
      setIsSubscribed(true);
      setPushStatus('granted');
    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
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
      alert('解除に失敗しました');
    } finally {
      setIsProcessing(false);
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
    <div className="space-y-3">
      <p className="section-label">通知</p>

      {pushStatus === "unsupported" ? (
        <p className="text-[13px] text-muted2">この端末は通知に対応していません。</p>
      ) : isIos && !isStandalone ? (
        <p className="text-[13px] text-muted2">
          iPhoneで通知を受け取るには、ブラウザの共有メニューから「ホーム画面に追加」をしてから、追加したアプリを開いて設定してください。
        </p>
      ) : (
        <>
          <Toggle
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
            <div className="space-y-1.5 pt-1">
              <p className="text-micro text-muted2">受け取る種類</p>
              <Toggle
                label="コメント"
                description="自分の投稿にコメントがついたとき"
                checked={comment}
                onChange={() => handleChange("notify_comment", !comment, setComment)}
              />
              <Toggle
                label="お知らせ"
                description="新しいお知らせが投稿されたとき"
                checked={notice}
                onChange={() => handleChange("notify_notice", !notice, setNotice)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
