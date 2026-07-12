import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // 注意: experimental.staleTimes（ルーターキャッシュTTL）は使わない。
  // cacheComponents との併用はビルド時に "use with caution" と警告される実験的な
  // 組み合わせで、導入後に実機iOS PWAで「タブ復帰時の完全フリーズ」「予定タブの
  // 一瞬のUIズレ」が報告された（2026-07-12。ローカルのChromium/WebKitでは再現せず、
  // 状況証拠による切り分け。FreezeProbeで実機の証拠収集中）。タブ切替の速さは
  // ①Vercel関数の東京リージョン固定（vercel.json）
  // ②各画面のreact-queryセッションキャッシュ（schedule/notes/mypage/timeline）
  // で担保する。
};

export default nextConfig;
