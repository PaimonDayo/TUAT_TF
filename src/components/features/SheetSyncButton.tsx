"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** 管理者向けのスプシ同期ボタン。安全処理を含む同期を1タップで実行する。 */
export function SheetSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hasIssue, setHasIssue] = useState(false);

  useEffect(() => {
    fetch("/api/sheets/sync-status")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setHasIssue(data?.latest?.hasIssue === true))
      .catch(() => undefined);
  }, []);

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
        setHasIssue(true);
        return;
      }
      setHasIssue(data.failedMembers?.length > 0);
      setMessage(
        `同期しました：取込 ${data.inserted} / 更新 ${data.updated} / 書き戻し ${data.pushed}` +
          (data.conflicts?.length ? ` / 競合スキップ ${data.conflicts.length}` : "") +
          (data.failedMembers?.length
            ? ` / 失敗 ${data.failedMembers.length}件（${data.failedMembers
                .map((f: { member: string }) => f.member)
                .join("、")}）`
            : ""),
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
        className="flex w-full items-center gap-3 text-headline text-accent active:opacity-60 disabled:opacity-50"
      >
        <RefreshCw size={20} className={busy ? "animate-spin" : ""} />
        {busy ? "同期中…" : "スプレッドシートと同期"}
      </button>

      {message && <p className="text-micro text-muted2">{message}</p>}
      {hasIssue && !message && <p className="text-micro text-danger">前回の同期に確認が必要な項目があります</p>}
    </div>
  );
}
