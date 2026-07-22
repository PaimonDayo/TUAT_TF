"use client";

import { useEffect } from "react";

/** 通知用Service Workerを、通知設定画面を開いたかに関係なく全ページで登録する。 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((error) => {
      console.error("Service Worker registration failed", error);
    });
  }, []);

  return null;
}