"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
    const channel = supabase
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

    function visible() {
      if (document.visibilityState === "visible") void refreshUnread();
    }
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(channel);
    };
  }, [refreshUnread, userId]);

  return (
    <Link
      href="/notices"
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
