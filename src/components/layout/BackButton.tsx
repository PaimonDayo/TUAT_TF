"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/** 直前のページに戻る（履歴がなければ fallback へ） */
export function BackButton({
  label = "戻る",
  fallback = "/home",
}: {
  label?: string;
  fallback?: string;
}) {
  const router = useRouter();

  function back() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      onClick={back}
      className="justify-self-start h-9 pl-1 pr-2 flex items-center gap-0.5 text-accent active:opacity-50 text-[15px]"
    >
      <ChevronLeft size={24} />
      {label}
    </button>
  );
}
