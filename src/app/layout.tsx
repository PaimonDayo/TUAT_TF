import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "陸上部ログ",
  description: "陸上競技部の練習記録・予定・ランキング共有アプリ",
  applicationName: "陸上部ログ",
  appleWebApp: {
    capable: true,
    title: "陸上部ログ",
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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
