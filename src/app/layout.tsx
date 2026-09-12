import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/app";
import SplashCountdown from "@/components/SplashCountdown";
import { SPLASH_COVER_ID, splashCoverScript } from "@/lib/splash-countdown";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  metadataBase: new URL("https://tuat-tf.vercel.app"),
  icons: {
    icon: [
      { url: "/branding/summer-favicon.ico", sizes: "any" },
      { url: "/branding/summer-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/branding/summer-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/branding/summer-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: [{ url: "/branding/summer-og-1200x630.jpg", width: 1200, height: 630, alt: `${APP_NAME} 夏季ビジュアル` }],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/branding/summer-og-1200x630.jpg"],
  },  title: APP_NAME,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // black-translucent: ステータスバーをコンテンツに重ねる（起動スプラッシュが
    // 時計・バッテリー領域まで描画される）。ヘッダー類は既に
    // env(safe-area-inset-top) でパディング済みなのでレイアウトは崩れない。
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f2f2f7",
  // キーボード表示時にビューポートを縮め、下からせり上がる入力欄が
  // キーボードの上に来るようにする（入力中の文字が隠れない）。
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full">
        {/*
          起動画面の下地。本文より前に置き、直後のスクリプトが同期で判定する。
          これが無いと、Reactがハイドレートして起動画面を出すまでの間ホームが見えてしまう。
        */}
        <div id={SPLASH_COVER_ID} aria-hidden="true" />
        <script dangerouslySetInnerHTML={{ __html: splashCoverScript }} />
        {process.env.NEXT_PUBLIC_PC_TRIAL === "true" && <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-950"><p role="status">PC試験版・本人限定｜変更はPC内のみ。スプシ同期・Push通知・画像変更・リアルタイム配信は停止中</p><form method="post" action="/_pc/logout"><button type="submit" className="mt-1 underline">試験版からログアウト</button></form></div>}
        {children}
        {process.env.NEXT_PUBLIC_PC_TRIAL !== "true" && <ServiceWorkerRegistrar />}
        <SplashCountdown />
      </body>
    </html>
  );
}
