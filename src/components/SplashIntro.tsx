"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SplashIntro.module.css";

const SESSION_KEY = "tuat-splash-played";
const FINISH_AFTER_MS = 3900;
const FADE_MS = 320;

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
            <path d="M110 275 C300 205 505 254 748 225 S1255 195 1490 286" />
            <path d="M130 650 C440 710 705 648 930 692 S1300 685 1480 600" />
            <path d="M125 274 C102 430 110 548 143 650" />
            <path d="M1488 287 C1515 420 1505 522 1478 600" />
          </svg>
          <div className={styles.title}>TUAT</div>
          <div className={styles.credit}>Track / Field</div>
        </section>
        <div className={styles.flash} />
      </main>
    </div>
  );
}
