"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { reconcilePushSubscription } from "@/lib/push";

const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 通知の購読が生きているかを、アプリを開くたびに静かに確かめ直す。
 * 端末に購読が残っていてもサーバー側の登録だけが消えていると、設定は「オン」の
 * ままなのに通知が1件も届かなくなるため、その場で登録し直す。
 * 画面には何も出さず、通知の許可も求めない。
 */
export function PushSubscriptionSync() {
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    const supabase = createClient();

    const run = () => {
      const now = Date.now();
      if (now - lastRunAtRef.current < RECHECK_INTERVAL_MS) return;
      lastRunAtRef.current = now;
      reconcilePushSubscription(supabase).catch(() => {});
    };

    run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
