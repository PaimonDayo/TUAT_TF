"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Health = {
  latest: null | {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    pulledCount: number;
    pushedCount: number;
    failedCount: number;
    hasIssue: boolean;
  };
  pendingPushCount: number;
  sheetProfileCount: number;
};

export function SystemSyncStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    fetch("/api/sheets/sync-status")
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Health>;
      })
      .then((data) => { if (active) setHealth(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [refreshKey]);

  const issue = health?.latest?.hasIssue || (health?.pendingPushCount ?? 0) > 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">システム</p>
        <button type="button" onClick={() => { setError(false); setHealth(null); setRefreshKey((key) => key + 1); }} className="p-1 text-muted active:opacity-50" aria-label="連携状態を再確認">
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="rounded-xl border border-separator bg-card p-3">
        <div className="flex items-center gap-2">
          {error ? <AlertTriangle size={18} className="text-danger" /> : issue ? <AlertTriangle size={18} className="text-warning" /> : <CheckCircle2 size={18} className="text-success" />}
          <span className="text-[14px] font-semibold">{error ? "状態を取得できません" : !health ? "確認中…" : issue ? "確認が必要です" : "連携は正常です"}</span>
        </div>
        {health && <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Metric label="スプシ利用" value={`${health.sheetProfileCount}人`} />
          <Metric label="未書き込み" value={`${health.pendingPushCount}件`} danger={health.pendingPushCount > 0} />
          <Metric label="前回エラー" value={`${health.latest?.failedCount ?? 0}人`} danger={(health.latest?.failedCount ?? 0) > 0} />
        </div>}
        {health?.latest && <p className="mt-3 flex items-center gap-1 text-micro text-muted"><Activity size={12} />最終確認 {new Date(health.latest.finishedAt ?? health.latest.startedAt).toLocaleString("ja-JP")}　取り込み {health.latest.pulledCount} / 書き込み {health.latest.pushedCount}</p>}
      </div>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-lg bg-bg px-1 py-2"><span className="block text-micro text-muted">{label}</span><span className={cn("mt-0.5 block text-[15px] font-bold tabular-nums", danger && "text-danger")}>{value}</span></div>;
}