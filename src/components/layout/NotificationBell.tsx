"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * PC運用中は Realtime を使えないので未読数をポーリングで見に行く。
 * この通信はブラウザ→Vercelの中継→PCのDBを毎回通るため、アプリ全体で
 * 一番回数の多い呼び出しになる。お知らせは秒単位の即時性を要さないので
 * 間隔を広めに取り、画面を見ていない間は止める（戻った瞬間に取り直す）。
 */
const PC_POLL_INTERVAL_MS = 120_000;

export function NotificationBell({
  userId,
  initialUnread,
}: {
  userId: string;
  initialUnread: number;
}) {
  const [unread, setUnread] = useState(initialUnread);

  const refreshUnread = useCallback(async () => {
    const supabase = createClient();
    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (typeof count === "number") setUnread(count);
  }, [userId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = process.env.NEXT_PUBLIC_PC_BACKEND === "true" ? null : supabase
      .channel(`notification-bell-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void refreshUnread(),
      )
      .subscribe();

    const polls = process.env.NEXT_PUBLIC_PC_BACKEND === "true";
    let timer: number | undefined;

    function stopTimer() {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    }
    // 表示中だけタイマーを動かす。裏に回っている間は1回も投げない。
    function startTimer() {
      if (!polls || timer !== undefined) return;
      timer = window.setInterval(() => void refreshUnread(), PC_POLL_INTERVAL_MS);
    }
    function visible() {
      if (document.visibilityState !== "visible") {
        stopTimer();
        return;
      }
      void refreshUnread();
      startTimer();
    }

    document.addEventListener("visibilitychange", visible);
    if (document.visibilityState === "visible") startTimer();
    return () => {
      document.removeEventListener("visibilitychange", visible);
      stopTimer();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refreshUnread, userId]);

  return (
    <Link
      href="/notices"
      prefetch={false}
      aria-label={unread > 0 ? `お知らせ、未読${unread}件` : "お知らせ"}
      className="relative flex h-9 w-9 items-center justify-center text-accent active:opacity-50"
    >
      <Bell size={22} strokeWidth={2} />
      {unread > 0 && (
        <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-red-500" />
      )}
    </Link>
  );
}
