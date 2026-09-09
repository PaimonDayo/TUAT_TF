"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { competitionDays } from "@/lib/competition";
import { jstToday } from "@/lib/date";
import {
  SPLASH_CACHE_KEY,
  SPLASH_DISABLED_KEY,
  SPLASH_SHOWN_KEY,
  readSplashCache,
  reelCells,
  shouldShowSplash,
  type SplashCountdownCache,
} from "@/lib/splash-countdown";
import styles from "./SplashCountdown.module.css";

const EXIT_AFTER_MS = 2600;
const REMOVE_AFTER_MS = 3050;

const TAB_ROUTES = [
  "/home", "/schedule", "/timeline", "/notes", "/mypage",
  "/members", "/notices", "/ranking", "/venues", "/blog",
];

/**
 * 起動画面。その日の最初の起動だけ、次の大会まであと何日かをカウンタで見せる。
 *
 * 大会の日付は端末に覚えておいて、開いた瞬間からすぐ出せるようにする（通信を待つと
 * アプリが見えた後に覆いが被さって不自然になるため）。覚え直すのは1日1回だけ。
 */
export default function SplashCountdown() {
  const router = useRouter();
  const [shown, setShown] = useState<{ name: string; days: number } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [rolled, setRolled] = useState(false);

  useEffect(() => {
    const today = jstToday();
    let cache: SplashCountdownCache | null = null;
    let shownOn: string | null = null;
    let disabled = false;
    try {
      cache = readSplashCache(localStorage.getItem(SPLASH_CACHE_KEY));
      shownOn = localStorage.getItem(SPLASH_SHOWN_KEY);
      disabled = localStorage.getItem(SPLASH_DISABLED_KEY) === "1";
    } catch {
      // Storage may be unavailable in a restricted browser context.
    }

    const days = cache ? competitionDays(cache.startsOn, today) : null;
    const show = shouldShowSplash({ cache, shownOn, disabled, today, days });

    if (show && cache && days !== null) {
      try {
        localStorage.setItem(SPLASH_SHOWN_KEY, today);
      } catch {
        // Continue even when persistence is unavailable.
      }
      // 端末に覚えている内容はサーバーでは読めないので、判断はマウント後にしかできない。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown({ name: cache.name, days });
    }

    // 覚えている日付を1日1回だけ取り直す。ログイン前は読めないので、そのときは何もしない。
    if (!cache || cache.fetchedOn !== today) void refreshCache(today);

    if (!show) return;

    const rollTimer = window.setTimeout(() => setRolled(true), 60);
    const prefetchTimer = window.setTimeout(() => {
      TAB_ROUTES.forEach((route, index) => {
        window.setTimeout(() => router.prefetch(route), index * 130);
      });
    }, 200);
    const exitTimer = window.setTimeout(() => setExiting(true), EXIT_AFTER_MS);
    const removeTimer = window.setTimeout(() => setShown(null), REMOVE_AFTER_MS);
    return () => {
      window.clearTimeout(rollTimer);
      window.clearTimeout(prefetchTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
    };
  }, [router]);

  if (!shown) return null;

  const digits = String(Math.max(0, shown.days)).split("").map(Number);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="起動画面をスキップ"
      onClick={() => setShown(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setShown(null);
      }}
      className={`${styles.overlay} ${exiting ? styles.exiting : ""}`}
    >
      <div className={styles.card}>
        {/* 当日は「まで」が付くと読みが崩れるので、大会名だけを置く。 */}
        <p className={styles.meet}>{shown.days === 0 ? shown.name : `${shown.name}まで`}</p>

        {shown.days === 0 ? (
          <p className={styles.opened}>いよいよ今日</p>
        ) : (
          <div className={styles.countRow} aria-label={`あと${shown.days}日`}>
            {digits.map((digit, index) => {
              // 上の桁ほど早く止める。一の位がいちばん長く回る。
              const spins = 2 + (digits.length - index);
              const { cells, offset } = reelCells(digit, spins);
              return (
                <span key={index} className={styles.reel} aria-hidden="true">
                  <span
                    className={styles.strip}
                    style={
                      {
                        "--spin-duration": `${900 + (digits.length - index) * 320}ms`,
                        "--spin-delay": `${index * 90}ms`,
                        transform: rolled ? `translateY(-${offset}em)` : "translateY(0)",
                      } as React.CSSProperties
                    }
                  >
                    {cells.map((value, cellIndex) => (
                      <span key={cellIndex} className={styles.digit}>
                        {value}
                      </span>
                    ))}
                  </span>
                </span>
              );
            })}
            <span className={styles.unit}>日</span>
          </div>
        )}

        <div className={styles.rule} />
        <p className={styles.hint}>タップで閉じる</p>
      </div>
    </div>
  );
}

/** カウントダウン対象の大会を読み直して端末へ覚えさせる（1日1回） */
async function refreshCache(today: string) {
  try {
    const { data } = await createClient()
      .from("competitions")
      .select("name,starts_on")
      .eq("is_countdown", true)
      .maybeSingle();
    if (!data) return;
    const next: SplashCountdownCache = {
      name: data.name,
      startsOn: data.starts_on,
      fetchedOn: today,
    };
    localStorage.setItem(SPLASH_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ログイン前・通信不調なら次の起動で取り直す。
  }
}
