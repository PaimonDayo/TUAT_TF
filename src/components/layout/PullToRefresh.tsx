"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 68;
const MAX_PULL = 104;
// router.refresh()の完了を示すコールバックはNext.jsに無い。
// useTransitionのisPendingで代用すると、Suspense境界が絡む画面（ホーム等、
// セクションごとに async Server Component が複数ある）で isPending が
// 解消されずインジケーターが回りっぱなしで固まる実例があったため使わない
// （2026-07-12、"リロードが終わらない"事故。以前に一度これで直した箇所を
// 再度useTransition化して再発させた）。固定時間で必ず止める。
const REFRESH_SPIN_MS = 900;

/** 画面最上部から下へ引いたとき、現在のServer Componentsを再取得する。 */
export function PullToRefresh() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const start = useRef<{ x: number; y: number } | null>(null);
  const distanceRef = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const refreshingRef = useRef(false);
  const [distance, setDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // 非passiveのtouchmoveを常時登録すると、アプリ内の**全スクロール**が
    // 毎フレームJSを経由し、iOSでスクロールがカクつく原因になる。
    // 「画面最上部から始まったタッチ」の間だけ動的に登録し、指を離したら外す。
    function detachGesture() {
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("touchcancel", cancel);
    }

    function reset() {
      start.current = null;
      distanceRef.current = 0;
      setDistance(0);
    }

    function cancel() {
      reset();
      detachGesture();
    }

    function touchStart(event: TouchEvent) {
      if (refreshingRef.current || window.scrollY > 0 || event.touches.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], input, textarea, select, [data-no-pull-refresh]')) return;
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
      window.addEventListener("touchmove", touchMove, { passive: false });
      window.addEventListener("touchend", touchEnd, { passive: true });
      window.addEventListener("touchcancel", cancel, { passive: true });
    }

    function touchMove(event: TouchEvent) {
      if (!start.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaY = touch.clientY - start.current.y;
      const deltaX = Math.abs(touch.clientX - start.current.x);
      if (deltaY <= 0 || deltaX > deltaY || window.scrollY > 0) {
        // 引き下げでないと分かった時点でジェスチャー追跡ごとやめる
        // （以降のスクロールを素通しにする）
        cancel();
        return;
      }
      event.preventDefault();
      const damped = Math.min(MAX_PULL, deltaY * 0.52);
      distanceRef.current = damped;
      setDistance(damped);
    }

    function touchEnd() {
      const shouldRefresh = distanceRef.current >= THRESHOLD;
      cancel();
      if (shouldRefresh) {
        refreshingRef.current = true;
        setIsRefreshing(true);
        router.refresh();
        void queryClient.invalidateQueries();
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => {
          refreshingRef.current = false;
          setIsRefreshing(false);
          refreshTimer.current = null;
        }, REFRESH_SPIN_MS);
      }
    }

    window.addEventListener("touchstart", touchStart, { passive: true });
    return () => {
      window.removeEventListener("touchstart", touchStart);
      detachGesture();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [queryClient, router]);

  const visible = distance > 4 || isRefreshing;
  const progress = Math.min(1, distance / THRESHOLD);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-40 transition-opacity duration-150"
      style={{
        top: "calc(env(safe-area-inset-top) + 8px)",
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, ${isRefreshing ? 4 : Math.max(-28, distance - 42)}px)`,
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-separator bg-card shadow-lg">
        <RefreshCw
          size={18}
          className={isRefreshing ? "animate-spin text-accent" : "text-accent"}
          style={{ transform: isRefreshing ? undefined : `rotate(${progress * 210}deg)` }}
        />
      </div>
      <span className="sr-only">
        {isRefreshing ? "更新中" : progress >= 1 ? "離して更新" : "下に引いて更新"}
      </span>
    </div>
  );
}
