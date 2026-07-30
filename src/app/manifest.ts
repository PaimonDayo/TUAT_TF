import type { MetadataRoute } from "next";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    // id はインストール済みアプリの同一性を決める。既定値は start_url なので、
    // 既存のホーム画面アイコンと同じ "/home" を明示して固定する（変更禁止）。
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#f2f2f7",
    theme_color: "#f2f2f7",
    lang: "ja",
    orientation: "portrait",
    icons: [
      { src: "/branding/summer-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/summer-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/summer-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
