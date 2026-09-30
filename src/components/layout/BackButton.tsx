"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";

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
    if (typeof window !== "undefined" && window.history.length > 1) {
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
