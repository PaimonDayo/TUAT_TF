"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { APP_NAME } from "@/lib/app";

const DISMISS_KEY = "pwa-install-dismissed-at";
// 一度閉じたら数日は再表示しない（しつこくしない）
const SNOOZE_MS = 1000 * 60 * 60 * 24 * 5;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * PWAとして起動していない人に「ホーム画面に追加（インストール）」を促すバナー。
 * ホーム画面の一番上にインライン表示する（自然に目に入るように）。
 * - Android/Chrome 等: beforeinstallprompt を捕まえてワンタップでインストール
 * - iOS: 専用APIが無いため「共有→ホーム画面に追加」の手順を案内
 * 既にスタンドアロン起動なら何も表示しない。閉じると数日は再表示しない。
 */
export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - dismissedAt < SNOOZE_MS) return;

    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    // iPadOSはMacを名乗ることがあるためタッチ対応Safariも判定に含める
    const iosLike =
      ios ||
      (/safari/.test(ua) && navigator.maxTouchPoints > 1 && !/chrome|crios|android/.test(ua));

    const handler = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOSはイベントが来ないので案内バナーを直接出す
    if (iosLike) {
      setIsIos(true);
      setShow(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  };

  const install = async () => {
    const d = deferredRef.current;
    if (!d) return;
    await d.prompt();
    await d.userChoice;
    deferredRef.current = null;
    dismiss();
  };

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/8 p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Download size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">アプリとして使う</p>
          {isIos ? (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted2">
              ホーム画面に追加すると、通知が受け取れて全画面で快適に使えます。
              <span className="mt-1 flex items-center gap-1 text-ink">
                共有
                <Share size={13} className="inline" />
                →「ホーム画面に追加
                <Plus size={13} className="inline" />
                」
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted2">
              {APP_NAME}をホーム画面に追加すると、通知が受け取れて全画面で快適に使えます。
            </p>
          )}
          {canPrompt && !isIos && (
            <button
              type="button"
              onClick={install}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white active:opacity-80"
            >
              <Download size={14} /> 追加する
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="閉じる"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-muted active:bg-bg"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
