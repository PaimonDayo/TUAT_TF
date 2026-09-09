import type { NextConfig } from "next";

const vercelPcTrial = process.env.PC_TRIAL_VERCEL === "true";
if (process.env.PC_BACKEND_ENABLED === "true" || process.env.NEXT_PUBLIC_PC_BACKEND === "true") {
  if (process.env.PC_BACKEND_ENABLED !== "true" || process.env.NEXT_PUBLIC_PC_BACKEND !== "true" ||
      process.env.NEXT_PUBLIC_PC_TRIAL === "true" || vercelPcTrial ||
      !/^https:\/\/[a-z0-9.-]+\.vercel\.app\/api\/pc-supabase$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") ||
      (process.env.PC_BACKEND_BRIDGE_KEY?.length ?? 0) < 32 || !process.env.PC_BACKEND_INSTANCE_ID) {
    throw new Error("PC production backend requires its dedicated Vercel API configuration");
  }
}
if (process.env.NEXT_PUBLIC_PC_TRIAL === "true") {
  if (vercelPcTrial) {
    const bridge = process.env.PC_TRIAL_BRIDGE_URL ?? "";
    if (process.env.VERCEL_ENV !== "preview" || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/_pc\/bridge$/.test(bridge) || process.env.NEXT_PUBLIC_SUPABASE_URL !== `${bridge}/_pc/supabase` || (process.env.PC_TRIAL_BRIDGE_KEY?.length ?? 0) < 32 || process.env.IMAGE_STORAGE_READ_ONLY !== "true") throw new Error("Vercel PC trial requires an isolated Preview and private PC bridge");
  } else if (process.env.VERCEL || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:8000") {
    throw new Error("PC trial requires a local build and the loopback Supabase API");
  }
} else if (vercelPcTrial) {
  throw new Error("Vercel PC trial requires trial protections");
}

const nextConfig: NextConfig = {
  ...(process.env.NEXT_PUBLIC_PC_TRIAL === "true" && !vercelPcTrial ? { distDir: ".next-pc-trial" } : {}),
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
