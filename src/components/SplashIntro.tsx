"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// 起動スプラッシュ演出（MV風タイトルアニメ「TUAT / Track / Field」）。
// CSSアニメ版は実機iPhoneで描画が重くカクついたため、プロトタイプ
// (C:\Users\rainb\video_repro_fix) をヘッドレスブラウザで25fpsキャプチャして
// 事前レンダリングした動画 /splash/intro.mp4 (780x1688, 5.0s = 演出3.4s + 余韻1.6s)
// を再生する方式に変更。動画なのでどの端末でも同じ見た目・同じ滑らかさになる。
// - 1セッション1回だけ再生（sessionStorage）。再生中に裏で各タブを router.prefetch する。
// - 未ログイン（Supabase の auth cookie 無し）のときはゆっくり再生（オーナー指定）。

const SESSION_KEY = "tuat-splash-played";
const FADE_MS = 550;
// 動画を最後まで待たず、再生可能になり次第開始する。
const START_CAP_MS = 1200;
// ended が発火しない異常系でも必ず終わらせる保険
const HARD_CAP_MS = 25000;

const TAB_ROUTES = [
  "/home",
  "/schedule",
  "/timeline",
  "/notes",
  "/mypage",
  "/members",
  "/notices",
  "/ranking",
  "/venues",
];

export default function SplashIntro() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return;
    if (
      sessionStorage.getItem(SESSION_KEY) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDone(true);
      return;
    }

    let cancelled = false;
    let started = false;
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    if (themeColor) themeColor.content = "#0b1020";

    const finish = () => {
      if (finished || cancelled) return;
      finished = true;
      sessionStorage.setItem(SESSION_KEY, "1");
      wrap.style.transition = `opacity ${FADE_MS}ms ease`;
      wrap.style.opacity = "0";
      timers.push(setTimeout(() => setDone(true), FADE_MS));
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
    };

    const begin = () => {
      if (cancelled || finished || started) return;
      started = true;
      // ログイン済みかは Supabase の auth cookie の有無で判定（未ログインはゆっくり再生）
      const loggedIn = /sb-[^=;]*-auth-token/.test(document.cookie);
      video.playbackRate = loggedIn ? 1 : 2 / 3; // 3.4s → 5.1s 相当
      video.play().catch(finish); // 自動再生が拒否されたら演出なしで即終了

      // 各タブの先読みは再生開始直後の負荷を避け、少し遅らせて分散実行
      TAB_ROUTES.forEach((route, i) => {
        timers.push(
          setTimeout(() => {
            try {
              router.prefetch(route);
            } catch {
              // prefetch失敗は無視（演出を止めない）
            }
          }, 80 + i * 180),
        );
      });
    };

    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      begin();
    } else {
      video.addEventListener("canplay", begin, { once: true });
    }
    timers.push(setTimeout(begin, START_CAP_MS));
    timers.push(setTimeout(finish, HARD_CAP_MS));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", finish);
      video.removeEventListener("canplay", begin);
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
    };
  }, [router]);

  if (done) return null;
  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#0b1020", overflow: "hidden" }}
    >
      <video
        ref={videoRef}
        src="/splash/intro.mp4?v=2"
        muted
        playsInline
        preload="auto"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-white"
        style={{ animation: "splash-white-fade 5s linear both" }}
      />
      <style>{`@keyframes splash-white-fade { 0%, 34%, 46%, 100% { opacity: 0 } 40% { opacity: 1 } }`}</style>
    </div>
  );
}
