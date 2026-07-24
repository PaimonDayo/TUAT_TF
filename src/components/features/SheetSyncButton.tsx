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
        setMessage(total > 0 ? `${processed}/${total}人を連携中…` : "準備中…");
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

        if (!data.chunk) throw new Error("うまくいきませんでした。時間をおいてお試しください");
        processed = Number(data.chunk.endOffset ?? 0);
        total = Number(data.chunk.totalMembers ?? 0);
        cycleComplete = data.chunk.cycleComplete === true;
      }

      if (!cycleComplete) throw new Error("対象が多いため途中で止まりました。もう一度お試しください");
      setHasIssue(failedMembers.length > 0);
      setMessage(
        `全${total}人ぶん完了しました：取り込み ${inserted}件 / 更新 ${updated}件 / 書き込み ${pushed}件` +
          (sheetReplies ? " / 返信 " + sheetReplies + "件" : "") +
          (conflictCount ? ` / 重複のため見送り ${conflictCount}件` : "") +
          (failedMembers.length
            ? ` / うまくいかなかった人 ${failedMembers.length}件（${failedMembers.join("、")}）`
            : ""),
      );
      router.refresh();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "通信エラー";
      setMessage(`うまくいきませんでした：${detail}`);
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
        {busy ? "連携中…" : "スプレッドシートと連携"}
      </button>

      {message && <p className="text-micro text-muted2">{message}</p>}
      {hasIssue && !message && <p className="text-micro text-danger">前回の連携で確認が必要な項目があります</p>}
    </div>
  );
}
