import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // クライアント側ルーターキャッシュ。一度開いたタブを一定時間そのまま再表示し、
    // タブ移動を高速化する（投稿・いいね・出欠などの操作後は router.refresh() で更新される）。
    staleTimes: {
      dynamic: 30, // 動的ページを30秒キャッシュ
      static: 180,
    },
  },
};

export default nextConfig;
