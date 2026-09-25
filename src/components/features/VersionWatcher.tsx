"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { startVisiblePolling } from "@/lib/visible-poll";

/**
 * 新しいバージョンが公開されたら、更新バナーを表示する。
 * 起動時に取得したバージョンと、定期取得したバージョンが異なれば「更新あり」。
 * デプロイは1日に何度もあるものではないので、定期取得は控えめにし、
 * 画面に戻ってきたときの確認を主にする（通信の大半はこちらで足りる）。
 */
const CHECK_INTERVAL_MS = 5 * 60_000;
export function VersionWatcher() {
  const [stale, setStale] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    return startVisiblePolling({
      intervalMs: CHECK_INTERVAL_MS,
      immediate: true,
      load: async (signal) => {
        const res = await fetch("/api/version", { cache: "no-store", signal });
        if (!res.ok) throw new Error("Version unavailable");
        return (await res.json()) as { version: string };
      },
      receive: ({ version }) => {
        if (!version) return;
        if (loaded.current === null) {
          loaded.current = version;
        } else if (version !== loaded.current) {
          setStale(true);
        }
      },
    });
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-50 bottom-[calc(66px+env(safe-area-inset-bottom))] w-[calc(100%-32px)] max-w-sm">
      <div className="flex items-center gap-3 rounded-card bg-ink/90 text-white px-4 py-3 shadow-lg backdrop-blur">
        <RefreshCw size={18} className="shrink-0" />
        <span className="text-[13px] flex-1">新しいバージョンがあります</span>
        <button
          onClick={() => window.location.reload()}
          className="text-[13px] font-bold text-accent bg-white rounded-full px-3.5 py-1.5 pressable"
        >
          更新
        </button>
      </div>
    </div>
  );
}
