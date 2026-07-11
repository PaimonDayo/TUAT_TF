"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SplashIntro.module.css";

const SESSION_KEY = "tuat-splash-played";
const FINISH_AFTER_MS = 5550;
const FADE_MS = 80;

const TAB_ROUTES = [
  "/home", "/schedule", "/timeline", "/notes", "/mypage",
  "/members", "/notices", "/ranking", "/venues",
];

export default function SplashIntro() {
  const router = useRouter();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (
      sessionStorage.getItem(SESSION_KEY) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDone(true);
      return;
    }

    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    if (themeColor) themeColor.content = "#101216";

    const prefetchTimer = window.setTimeout(() => {
      TAB_ROUTES.forEach((route, index) => {
        window.setTimeout(() => router.prefetch(route), index * 130);
      });
    }, 60);
    const finishTimer = window.setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, "1");
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
      window.setTimeout(() => setDone(true), FADE_MS);
    }, FINISH_AFTER_MS);

    return () => {
      window.clearTimeout(prefetchTimer);
      window.clearTimeout(finishTimer);
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
    };
  }, [router]);

  if (done) return null;

  return (
    <div aria-hidden="true" className={styles.overlay}>
      <main className={styles.stage}>
        <section className={`${styles.scene} ${styles.paper}`} />
        <section className={`${styles.scene} ${styles.film}`} />
        <section className={`${styles.scene} ${styles.mega}`}>
          <div className={styles.blackRow}>
            {"TUAT".split("").map((letter, index) => (
              <div className={`${styles.blackGlyph} ${styles[`black${index}`]}`} key={index}><span>{letter}</span></div>
            ))}
          </div>
        </section>
        <section className={`${styles.scene} ${styles.center}`}>
          <div className={styles.wordRow}>
            {"TUAT".split("").map((letter, index) => (
              <div className={`${styles.wipe} ${styles[`wipe${index}`]}`} key={index}><span>{letter}</span></div>
            ))}
          </div>
        </section>
        <section className={`${styles.scene} ${styles.final}`}>
          <svg className={styles.frame} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet">
            <defs>
              <filter id="splash-frame-rough" x="-6%" y="-6%" width="112%" height="112%">
                <feTurbulence type="fractalNoise" baseFrequency="0.013 0.022" numOctaves="2" seed="8" />
                <feDisplacementMap in="SourceGraphic" scale="11" />
              </filter>
              <filter id="splash-frame-brush" x="-8%" y="-8%" width="116%" height="116%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="6" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" />
              </filter>
              <linearGradient id="splash-line-color" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="150" y2="95" spreadMethod="repeat">
                <stop offset="0" stopColor="#6a48c4" /><stop offset=".16" stopColor="#3f7ae0" />
                <stop offset=".28" stopColor="#8a5ad0" /><stop offset=".4" stopColor="#e878c0" />
                <stop offset=".5" stopColor="#47c4e8" /><stop offset=".62" stopColor="#5a3fb4" />
                <stop offset=".74" stopColor="#d84a9c" /><stop offset=".84" stopColor="#4a8ae4" />
                <stop offset=".93" stopColor="#f0ecf6" /><stop offset="1" stopColor="#6a48c4" />
              </linearGradient>
            </defs>
            <g filter="url(#splash-frame-rough)" transform="rotate(-1 800 460)">
              <path className={styles.frame1} d="M 445 345 L 900 300 L 1145 285 M 1160 288 L 1245 330 L 1232 560 M 1228 566 L 1060 640 L 700 660 M 640 662 L 520 668 L 400 600 L 418 402 L 442 350" />
              <path className={styles.frame2} d="M 430 358 L 890 312 M 1150 298 L 1236 342 M 1222 574 L 1052 652 L 530 678 M 408 610 L 426 408" />
              <path className={styles.frame3} d="M 292 372 L 560 322 M 1108 246 L 1338 356 M 1296 252 L 1172 368 M 1258 276 L 1238 630" />
              <path className={styles.frame4} d="M 252 778 L 388 742 M 402 738 L 560 700 M 300 828 L 452 788 M 470 782 L 618 742" />
              <path className={styles.frame5} d="M 452 336 L 1148 276 M 1240 336 L 1226 556" />
            </g>
          </svg>
          <div className={styles.title}>TUAT</div>
          <div className={styles.credit}>Track / Field</div>
        </section>
        <div className={styles.flash} />
      </main>
    </div>
  );
}
