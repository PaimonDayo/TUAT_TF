import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 注意: cacheComponents(PPR) は有効化しない。
  // 2026-07-12 00:14 に「タブ復元の高速化」目的で有効化した直後から、実機iOS PWAで
  // 「別タブ→ホームで毎回完全フリーズ」「予定/タイムラインのフリーズ」「リロード時の
  // 配置ガクつき」が発生した（AGENTS.mdの重大インシデント節参照）。
  // Tab Lab実測で「Routerを通さない実DOM再構築は最大75msで安定」＝問題はRouter/PPR層と
  // 切り分け済み。IDB永続化・Server Action・prefetch・PullToRefresh・staleTimesを
  // 全て撤去しても再現したため、最後に残ったこの層を無効化して検証する。
  // タブ切替の速さは①Vercel関数の東京リージョン固定（vercel.json）
  // ②各画面のreact-queryセッションキャッシュ ③loading.tsxスケルトンで担保する。
  //
  // 同様に experimental.staleTimes も再導入しないこと（同日の教訓）。
};

export default nextConfig;
