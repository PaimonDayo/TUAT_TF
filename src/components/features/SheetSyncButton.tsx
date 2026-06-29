"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** 管理者向けのスプシ同期ボタン。安全処理を含む同期を1タップで実行する。 */
export function SheetSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sheets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setMessage(`失敗: ${data.error ?? res.status}`);
        return;
      }
      setMessage(
        `同期しました：取込 ${data.inserted} / 更新 ${data.updated} / 書き戻し ${data.pushed}` +
          (data.conflicts?.length ? ` / 競合スキップ ${data.conflicts.length}` : ""),
      );
      router.refresh();
    } catch {
      setMessage("通信エラーで失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-2">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="flex items-center gap-2 text-[15px] text-accent active:opacity-60 disabled:opacity-50"
      >
        <RefreshCw size={18} className={busy ? "animate-spin" : ""} />
        {busy ? "同期中…" : "スプレッドシートと同期"}
      </button>

      {message && <p className="text-micro text-muted2">{message}</p>}
    </div>
  );
}
