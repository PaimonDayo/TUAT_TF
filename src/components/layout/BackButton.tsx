"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";

function hasAppBackEntry() {
  if (typeof window === "undefined" || window.history.length <= 1) return false;
  // history.length also includes a new tab's initial about:blank. Navigation
  // exposes whether this origin actually has a preceding entry.
  const navigation = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
  if (typeof navigation?.canGoBack === "boolean") return navigation.canGoBack;
  const isDifferentAppUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.origin === window.location.origin && url.href !== window.location.href;
    } catch { return false; }
  };
  if (isDifferentAppUrl(document.referrer)) return true;
  // Older browsers keep the original document URL during SPA navigation.
  // A query replace in a direct tab alone does not create a predecessor.
  const documentUrl = performance.getEntriesByType("navigation")[0]?.name;
  return window.history.length > 2 && !!documentUrl && isDifferentAppUrl(documentUrl);
}

/** 直前のページに戻る（履歴がなければ fallback へ） */
export function BackButton({
  label = "戻る",
  fallback = "/home",
  forceFallback = false,
}: {
  label?: string;
  fallback?: string;
  forceFallback?: boolean;
}) {
  const router = useRouter();
  const systemGlass = useSystemGlass();

  function back() {
    if (forceFallback) {
      router.push(fallback);
      return;
    }
    if (hasAppBackEntry()) {
      // router.back() は standalone PWA 等で稀に無反応になる。
      // 一定時間 URL が変わらなければ fallback へ確実に戻す。
      const before = window.location.href;
      router.back();
      window.setTimeout(() => {
        if (window.location.href === before) router.push(fallback);
      }, 500);
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      type="button"
      data-glass-control
      data-system-glass={systemGlass || undefined}
      aria-label={label}
      onClick={back}
      className={systemGlass
        ? "justify-self-start flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink pressable"
        : "justify-self-start h-9 pl-1 pr-2 flex items-center gap-0.5 text-accent pressable text-[15px]"}
    >
      <ChevronLeft size={24} aria-hidden="true" />
      {!systemGlass && label}
    </button>
  );
}
