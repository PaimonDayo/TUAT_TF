"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ServiceHealth, ServiceStatus } from "@/lib/service-status";

const healthLabels = { none: "全体の稼働は正常", minor: "一部に影響あり", major: "障害あり", critical: "重大な障害あり", unknown: "障害情報を取得できません" };
const missing = { unconfigured: "連携設定が必要です", error: "取得できませんでした" };
const gb = (n: number) => `${(n / 1_000_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 3 })} GB`;

export function ServiceStatusPanel() {
  const query = useQuery<ServiceStatus>({
    queryKey: ["admin-service-status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/services", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "システム管理権限が必要です" : "状態を取得できませんでした。時間をおいて再確認してください。");
      return response.json();
    },
    staleTime: 15 * 60 * 1000, gcTime: 0, retry: false, refetchOnWindowFocus: false,
  });
  const data = query.data;
  return <div className="space-y-4 px-4 pb-8 pt-1">
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm text-muted">システム管理者だけが確認できます。障害情報は各サービス全体の状況です。</p>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="flex shrink-0 items-center gap-1 rounded-lg border border-separator px-3 py-2 text-sm disabled:opacity-50">
        <RefreshCw size={14} className={query.isFetching ? "animate-spin" : ""} />再確認
      </button>
    </div>
    {query.isPending && <p role="status" className="text-sm text-muted">確認中…</p>}
    {query.isError && <p role="alert" className="text-sm text-danger">{query.error.message}</p>}
    {data && <>
      <p className="text-micro text-muted">取得日時: {new Date(data.checkedAt).toLocaleString("ja-JP")}<br />通信量を抑えるため、結果を15分間再利用します。</p>
      <ServiceCard name="Supabase" health={data.health.supabase} statusUrl="https://status.supabase.com" usageUrl="https://supabase.com/dashboard/org/cctqtlkeltdpjkyyjmfl/usage">
        <p className="text-sm">データベース・ログイン認証</p>
        <p className="text-sm text-muted">月間転送量・DB容量・無料枠の残量: 未取得</p>
        <p className="text-micro text-muted">正確な使用量と利用制限は「使用量を開く」で確認してください。全体の稼働が正常でも、このプロジェクトに利用制限がかかっている場合があります。</p>
      </ServiceCard>
      <ServiceCard name="Cloudflare R2" health={data.health.cloudflare} statusUrl="https://www.cloudflarestatus.com" usageUrl="https://dash.cloudflare.com/a4e843f4713c95818cb08594164541b7/r2/overview">
        {data.r2.state === "ready" ? <>
          <div className="flex justify-between gap-3 text-sm"><span>画像バケットの保存容量</span><strong>{gb(data.r2.bytes!)} / {data.images.limitBytes === null ? "上限設定エラー" : gb(data.images.limitBytes)}</strong></div>
          {data.images.limitBytes !== null && <progress aria-label="画像保存容量の使用率" max={data.images.limitBytes} value={data.r2.bytes!} className="h-2 w-full accent-current" />}
          <p className="text-micro text-muted">{data.r2.objects!.toLocaleString("ja-JP")}ファイル。上限はアプリの保存停止目安です。R2の月平均使用量・請求上限とは異なります。</p>
          {data.images.limitBytes !== null && data.r2.bytes! >= data.images.limitBytes * 0.8 && <p className="text-sm text-warning">保存容量が停止目安の80%以上です。</p>}
        </> : <p className="text-sm text-muted">保存容量: {missing[data.r2.state]}</p>}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>画像の読み込み</dt><dd>{data.images.reads ? "R2優先" : "Supabase"}</dd>
          <dt>新しい画像の保存</dt><dd>{data.images.writes ? data.images.paused ? "一時停止中" : "R2" : "Supabase"}</dd>
        </dl>
        {data.images.writes && !data.images.reads && <p className="text-sm text-danger">画像の読み込み設定が不足しています。保存できません。</p>}
        <p className="text-micro text-muted">月間の操作回数・アカウント全体の無料枠残量は「使用量を開く」で確認できます。</p>
      </ServiceCard>
      <ServiceCard name="Vercel" health={data.health.vercel} statusUrl="https://www.vercel-status.com" usageUrl="https://vercel.com/paimondayos-projects/~/usage">
        {data.vercel.state === "ready" ? <>
          <p className="text-sm">チーム全体の使用量（UTC暦月）</p>
          <p className="text-micro text-muted">{data.vercel.from.slice(0, 10)} ～ {data.vercel.to.slice(0, 10)}。請求期間とは異なり、集計には遅れがあります。</p>
          {data.vercel.usage.length ? <dl className="space-y-2">{data.vercel.usage.map((row) => <div key={`${row.name}:${row.unit}`} className="flex flex-wrap justify-between gap-1 text-sm"><dt className="break-words">{row.name}</dt><dd className="font-semibold">{row.quantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })} {row.unit}</dd></div>)}</dl> : <p className="text-sm text-muted">対象期間の使用量レコードはありません。未集計の可能性があります。</p>}
        </> : <p className="text-sm text-muted">呼び出し回数・使用量: {missing[data.vercel.state]}</p>}
        <p className="text-micro text-muted">契約プラン・請求額・無料枠の残量は「使用量を開く」で確認できます。</p>
      </ServiceCard>
    </>}
  </div>;
}

function ServiceCard({ name, health, statusUrl, usageUrl, children }: { name: string; health: ServiceHealth; statusUrl: string; usageUrl: string; children: React.ReactNode }) {
  return <Card className="space-y-3 p-4">
    <h2 className="text-base font-bold">{name}</h2>
    <p className={`text-sm font-semibold ${health.indicator === "none" ? "text-success" : health.indicator === "unknown" ? "text-muted" : "text-warning"}`}>{healthLabels[health.indicator]}</p>
    {health.incidents.length > 0 && <ul className="list-disc space-y-1 pl-4 text-micro text-muted">{health.incidents.map((incident, index) => <li key={index}>{incident}</li>)}</ul>}
    {children}
    <div className="flex flex-wrap gap-4 border-t border-separator pt-3 text-sm">
      <a href={usageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">使用量を開く<ExternalLink size={13} /></a>
      <a href={statusUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-muted">障害情報<ExternalLink size={13} /></a>
    </div>
  </Card>;
}
