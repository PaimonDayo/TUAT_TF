import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // クライアント側ルーターキャッシュ。一度開いたタブを一定時間そのまま再表示し、
    // タブ移動を高速化する。局所操作はClient Componentのstateを更新し、
    // 複数領域へ影響する変更だけ router.refresh() を使う。
    // dynamic=30秒だと起動時（スプラッシュ中）にBottomNavのLink prefetch={true}で
    // 全タブを先読みしても30秒で失効し、タップのたびにサーバー往復待ちになるため
    // 300秒に延長（タイムラインIndexedDBキャッシュの5分TTLと揃える）。
    // 鮮度は引っ張って更新（router.refresh）と各画面のセッションキャッシュ側で担保。
    staleTimes: {
      dynamic: 300,
      static: 900,
    },
  },
};

export default nextConfig;
