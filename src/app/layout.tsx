import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/app";
import SplashIntro from "@/components/SplashIntro";
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
        <ServiceWorkerRegistrar />
        <SplashIntro />
      </body>
    </html>
  );
}
