"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

function subscribe(listener:()=>void) {
  window.addEventListener("online",listener);window.addEventListener("offline",listener);
  return ()=>{window.removeEventListener("online",listener);window.removeEventListener("offline",listener);};
}
export function ObLiveRefresh() {
  const online=useSyncExternalStore(subscribe,()=>navigator.onLine,()=>true);
  const router=useRouter(),[pending,startTransition]=useTransition();
  useEffect(()=>{
    // Never replace a route beneath an open editor; its save reconciles newer data.
    const refresh=()=>{if(document.visibilityState==="visible"&&navigator.onLine&&!document.querySelector('[role="dialog"]'))startTransition(()=>router.refresh());};
    const interval=window.setInterval(refresh,30000);
    window.addEventListener("online",refresh);document.addEventListener("visibilitychange",refresh);
    return ()=>{clearInterval(interval);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[router]);
  return <div className="flex items-center justify-end gap-3">{!online&&<p role="status" className="text-caption text-amber-700">通信が切れています。編集中の内容は保存まで残ります。</p>}<button type="button" aria-label="大会情報を最新に更新" disabled={!online||pending} onClick={()=>startTransition(()=>router.refresh())} className="flex min-h-11 shrink-0 items-center gap-2 px-2 text-sm text-muted disabled:opacity-50"><RefreshCw size={15} className={pending?"animate-spin":""}/>{pending?"更新中":"最新に更新"}</button></div>;
}
