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
      let resetCycle = true;
      let cycleComplete = false;
      let processed = 0;
      let total = 0;
      let inserted = 0;
      let updated = 0;
      let pushed = 0;
      let sheetReplies = 0;
      const failedMembers: string[] = [];
      let conflictCount = 0;

      for (let requestCount = 0; requestCount < 20 && !cycleComplete; requestCount++) {
        setMessage(total > 0 ? `${processed}/${total}人を同期中…` : "同期対象を準備中…");
        const res = await fetch("/api/sheets/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resetCycle }),
        });
        resetCycle = false;
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        inserted += Number(data.inserted ?? 0);
        updated += Number(data.updated ?? 0);
        pushed += Number(data.pushed ?? 0);
        sheetReplies += Number(data.sheetReplies ?? 0);
        conflictCount += Array.isArray(data.conflicts) ? data.conflicts.length : 0;
        if (Array.isArray(data.failedMembers)) {
          failedMembers.push(
            ...data.failedMembers.map((failure: { member?: string }) => failure.member ?? "不明"),
          );
        }

        if (!data.chunk) throw new Error("同期の進捗情報がありません");
        processed = Number(data.chunk.endOffset ?? 0);
        total = Number(data.chunk.totalMembers ?? 0);
        cycleComplete = data.chunk.cycleComplete === true;
      }

      if (!cycleComplete) throw new Error("同期対象が多いため20回で中断しました");
      setHasIssue(failedMembers.length > 0);
      setMessage(
        `全${total}人を同期しました：取込 ${inserted} / 更新 ${updated} / 書き戻し ${pushed}` +
          (sheetReplies ? " / スプシ返信 " + sheetReplies : "") +
          (conflictCount ? ` / 競合スキップ ${conflictCount}` : "") +
          (failedMembers.length
            ? ` / 失敗 ${failedMembers.length}件（${failedMembers.join("、")}）`
            : ""),
      );
      router.refresh();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "通信エラー";
      setMessage(`失敗: ${detail}`);
      setHasIssue(true);
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
