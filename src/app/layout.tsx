import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/app";
import SplashIntro from "@/components/SplashIntro";

export const metadata: Metadata = {
  title: APP_NAME,
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
  maximumScale: 1,
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem("tuat-splash-played")==="1")document.documentElement.dataset.tuatSplashSkip="1"}catch(e){}`,
          }}
        />
        <style>{`html[data-tuat-splash-skip="1"] .tuat-splash-root{display:none!important}`}</style>
      </head>
      <body className="min-h-full">
        {children}
        <SplashIntro />
      </body>
    </html>
  );
}
