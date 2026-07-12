"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useToast } from "@/components/ui/toast";

const PROBE_KEY = "tuat-freeze-probe";
const SAFE_EXIT_KEY = "tuat-freeze-probe-safe";
const REPORTS_KEY = "tuat-freeze-reports";
const BEAT_MS = 1000;

type Probe = { t: number; path: string };
type Report = { at: number; path: string; foundAt: number };

/**
 * 実機の「完全フリーズ」調査用プローブ（2026-07-12 オーナー報告対応）。
 *
 * 動作中は1秒ごとに現在時刻とパスを localStorage へ記録する。
 * バックグラウンド移行や通常の離脱（visibilitychange: hidden / pagehide）では
 * 「正常離脱」フラグを立てる。メインスレッドが固まると心拍もフラグ書き込みも
 * 止まるため、次回起動時に「正常離脱フラグ無しで心拍が途絶」していれば
 * フリーズ（またはクラッシュ）が起きたと判定できる。
 *
 * レポートは console.warn と localStorage（直近5件）に残し、
 * システム管理者（notify=true）にだけトーストで場所を知らせる。
 */
export function FreezeProbe({ notify = false }: { notify?: boolean }) {
  const pathname = usePathname();
  const { showToast } = useToast();

  // 起動時: 前回セッションの痕跡を判定してから、自分の記録を開始する。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROBE_KEY);
      const safeExit = localStorage.getItem(SAFE_EXIT_KEY) === "1";
      if (raw && !safeExit) {
        const probe = JSON.parse(raw) as Probe;
        const report: Report = { at: probe.t, path: probe.path, foundAt: Date.now() };
        const reports = [
          report,
          ...(JSON.parse(localStorage.getItem(REPORTS_KEY) ?? "[]") as Report[]),
        ].slice(0, 5);
        localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
        console.warn(
          `[FreezeProbe] 前回セッションが異常終了: ${probe.path} で ${new Date(probe.t).toLocaleString("ja-JP")} に応答停止`,
        );
        if (notify) {
          showToast(
            `前回 ${probe.path} でフリーズの痕跡（${new Date(probe.t).toLocaleTimeString("ja-JP")}）`,
            "error",
          );
        }
      }
      localStorage.removeItem(SAFE_EXIT_KEY);
    } catch {
      // localStorage不調時は調査を諦める（アプリ動作は妨げない）
    }
    // 起動時に一度だけ判定する（pathname変更では再実行しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const beat = () => {
      try {
        localStorage.setItem(PROBE_KEY, JSON.stringify({ t: Date.now(), path: pathname } satisfies Probe));
      } catch {
        // ignore
      }
    };
    beat();
    const id = window.setInterval(beat, BEAT_MS);

    const markSafe = () => {
      try {
        localStorage.setItem(SAFE_EXIT_KEY, "1");
      } catch {
        // ignore
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        markSafe();
      } else {
        try {
          localStorage.removeItem(SAFE_EXIT_KEY);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("pagehide", markSafe);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", markSafe);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  return null;
}
