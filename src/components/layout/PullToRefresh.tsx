"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 68;
const MAX_PULL = 104;

/** 画面最上部から下へ引いたとき、現在のServer Componentsを再取得する。 */
export function PullToRefresh() {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);
  const distanceRef = useRef(0);
  const [distance, setDistance] = useState(0);
  const [isPending, startRefresh] = useTransition();

  useEffect(() => {
    function reset() {
      start.current = null;
      distanceRef.current = 0;
      setDistance(0);
    }

    function touchStart(event: TouchEvent) {
      if (isPending || window.scrollY > 0 || event.touches.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], input, textarea, select, [data-no-pull-refresh]')) return;
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
    }

    function touchMove(event: TouchEvent) {
      if (!start.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaY = touch.clientY - start.current.y;
      const deltaX = Math.abs(touch.clientX - start.current.x);
      if (deltaY <= 0 || deltaX > deltaY || window.scrollY > 0) {
        reset();
        return;
      }
      event.preventDefault();
      const damped = Math.min(MAX_PULL, deltaY * 0.52);
      distanceRef.current = damped;
      setDistance(damped);
    }

    function touchEnd() {
      if (!start.current) return;
      const shouldRefresh = distanceRef.current >= THRESHOLD;
      reset();
      if (shouldRefresh) startRefresh(() => router.refresh());
    }

    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchmove", touchMove, { passive: false });
    window.addEventListener("touchend", touchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [isPending, router]);

  const visible = distance > 4 || isPending;
  const progress = Math.min(1, distance / THRESHOLD);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-40 transition-opacity duration-150"
      style={{
        top: "calc(env(safe-area-inset-top) + 8px)",
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, ${isPending ? 4 : Math.max(-28, distance - 42)}px)`,
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-separator bg-card shadow-lg">
        <RefreshCw
          size={18}
          className={isPending ? "animate-spin text-accent" : "text-accent"}
          style={{ transform: isPending ? undefined : `rotate(${progress * 210}deg)` }}
        />
      </div>
      <span className="sr-only">
        {isPending ? "更新中" : progress >= 1 ? "離して更新" : "下に引いて更新"}
      </span>
    </div>
  );
}
