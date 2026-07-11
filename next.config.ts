import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // クライアント側ルーターキャッシュ。一度開いたタブを一定時間そのまま再表示し、
    // タブ移動を高速化する。局所操作はClient Componentのstateを更新し、
    // 複数領域へ影響する変更だけ router.refresh() を使う。
    staleTimes: {
      dynamic: 30, // 動的ページを30秒キャッシュ
      static: 900,
    },
  },
};

export default nextConfig;
