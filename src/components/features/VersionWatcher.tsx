"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * 新しいバージョンが公開されたら、更新バナーを表示する。
 * 起動時に取得したバージョンと、定期取得したバージョンが異なれば「更新あり」。
 */
export function VersionWatcher() {
  const [stale, setStale] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string };
        if (!active || !version) return;
        if (loaded.current === null) {
          loaded.current = version;
        } else if (version !== loaded.current) {
          setStale(true);
        }
      } catch {
        // ネット不調などは無視
      }
    }

    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(check, 60_000);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-50 bottom-[calc(66px+env(safe-area-inset-bottom))] w-[calc(100%-32px)] max-w-sm">
      <div className="flex items-center gap-3 rounded-2xl bg-ink/90 text-white px-4 py-3 shadow-lg backdrop-blur">
        <RefreshCw size={18} className="shrink-0" />
        <span className="text-[13px] flex-1">新しいバージョンがあります</span>
        <button
          onClick={() => window.location.reload()}
          className="text-[13px] font-bold text-accent bg-white rounded-full px-3.5 py-1.5 active:opacity-70"
        >
          更新
        </button>
      </div>
    </div>
  );
}
