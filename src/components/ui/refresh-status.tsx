"use client";

export function RefreshStatus({ failed, busy, retry, label = "内容", hasData = true }: { failed: boolean; busy: boolean; retry: () => void; label?: string; hasData?: boolean }) {
  if (!failed && !busy) return null;
  return <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-card bg-bg px-3 py-2 text-caption">
    <span>{busy ? `${label}を更新中…` : hasData ? `${label}を更新できませんでした。前回の内容を表示しています。` : `${label}を取得できませんでした。もう一度お試しください。`}</span>
    {failed && <button data-ui-action="text" data-ui-tone="primary" type="button" disabled={busy} onClick={retry} className="shrink-0 text-accent">再試行</button>}
  </div>;
}
