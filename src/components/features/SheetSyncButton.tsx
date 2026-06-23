"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type Plan = {
  inserted: number;
  updated: number;
  pushed: number;
  conflicts: string[];
  skippedMembers: string[];
};

/**
 * 管理者向けのスプシ同期ボタン。
 * まず「確認（ドライラン＝読み取りのみ）」で何が起きるかを表示し、
 * 納得してから「実際に反映する」で適用する。
 */
export function SheetSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sheets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setMessage(`失敗: ${data.error ?? res.status}`);
        return;
      }
      if (dryRun) {
        setPlan(data as Plan);
      } else {
        setPlan(null);
        setMessage(
          `反映しました：取込 ${data.inserted} / 更新 ${data.updated} / 書き戻し ${data.pushed}` +
            (data.conflicts?.length ? ` / 競合スキップ ${data.conflicts.length}` : ""),
        );
        router.refresh();
      }
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
        onClick={() => call(true)}
        disabled={busy}
        className="flex items-center gap-2 text-[15px] text-accent active:opacity-60 disabled:opacity-50"
      >
        <RefreshCw size={18} className={busy ? "animate-spin" : ""} />
        {busy ? "確認中…" : "スプレッドシートと同期（まず確認）"}
      </button>

      {plan && (
        <div className="rounded-xl border border-separator bg-bg/40 p-3 space-y-2 text-[13px]">
          <p className="text-muted2">この内容で反映されます：</p>
          <ul className="space-y-0.5">
            <li>スプシ→アプリ 取込: <b>{plan.inserted}</b> 件（新規）/ <b>{plan.updated}</b> 件（更新）</li>
            <li>アプリ→スプシ 書き戻し: <b>{plan.pushed}</b> 件</li>
            {plan.conflicts.length > 0 && (
              <li className="text-warning">
                同日に複数記録ありでスキップ: {plan.conflicts.length} 件（{plan.conflicts.join("、")}）
              </li>
            )}
            {plan.skippedMembers.length > 0 && (
              <li className="text-muted">シート未検出: {plan.skippedMembers.join("、")}</li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => call(false)}
            disabled={busy}
            className="h-10 w-full rounded-lg bg-accent text-[14px] font-semibold text-white active:opacity-80 disabled:opacity-50"
          >
            実際に反映する
          </button>
        </div>
      )}

      {message && <p className="text-micro text-muted2">{message}</p>}
    </div>
  );
}
