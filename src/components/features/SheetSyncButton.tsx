"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * 管理者向け「今すぐ同期」ボタン。
 * /api/sheets/sync を叩いてスプシ⇔練習記録を双方向同期し、結果を簡易表示する。
 */
export function SheetSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sheets/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setMessage(`同期に失敗: ${data.error ?? res.status}`);
      } else {
        setMessage(`完了：取込 ${data.pulled} 件 / 書き戻し ${data.pushed} 件`);
        router.refresh();
      }
    } catch {
      setMessage("同期に失敗しました（通信エラー）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="flex w-full items-center gap-3 p-4 text-left active:bg-bg disabled:opacity-60"
      >
        <RefreshCw size={18} className={busy ? "animate-spin text-accent" : "text-accent"} />
        <span className="flex-1 text-[15px]">
          {busy ? "同期中…" : "スプレッドシートと今すぐ同期"}
        </span>
      </button>
      {message && <p className="px-4 pb-3 -mt-1 text-micro text-muted2">{message}</p>}
    </div>
  );
}
