"use client";

import { useEffect, useRef, useState } from "react";
import { NoticeCard } from "@/components/cards/NoticeCard";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationsList } from "./NotificationsList";
import type { NoticeWithReactions, AppNotificationWithActor, Profile } from "@/types";

export function NoticesClient({
  profile,
  notices,
  notifications,
  canCreateNotice,
}: {
  profile: Pick<Profile, "id" | "roles">;
  notices: NoticeWithReactions[];
  notifications: AppNotificationWithActor[];
  canCreateNotice: boolean;
}) {
  const [tab, setTab] = useState<"notice" | "for_you">("notice");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pendingScroll = useRef<string | null>(null);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 通知から特定のお知らせを開く: お知らせタブへ切替＋展開＋スクロール */
  function openNotice(id: string) {
    setExpanded((prev) => new Set(prev).add(id));
    setTab("notice");
    pendingScroll.current = id;
  }

  useEffect(() => {
    const match = window.location.hash.match(/^#notice-(.+)$/);
    if (!match) return;
    const id = window.setTimeout(() => {
      setTab("notice");
      setExpanded((current) => new Set(current).add(match[1]));
      pendingScroll.current = match[1];
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  // タブ切替・展開反映後に対象カードへスクロール
  useEffect(() => {
    if (tab !== "notice" || !pendingScroll.current) return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => {
      document
        .getElementById(`notice-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [tab, expanded]);

  return (
    <div className="space-y-4">
      <div className="px-4 mt-2">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          items={[
            { key: "notice", label: "お知らせ" },
            { key: "for_you", label: "あなたへ" },
          ]}
        />
      </div>

      <div className="px-4 space-y-3 pb-8">
        {tab === "notice" &&
          (notices.length === 0 ? (
            <EmptyState title="お知らせはありません" />
          ) : (
            notices.map((n) => (
              <NoticeCard
                key={n.id}
                notice={n}
                userId={profile.id}
                canManage={canCreateNotice}
                expanded={expanded.has(n.id)}
                onToggle={() => toggleExpand(n.id)}
              />
            ))
          ))}

        {tab === "for_you" && (
          <NotificationsList
            initialNotifications={notifications}
            onOpenNotice={openNotice}
          />
        )}
      </div>
    </div>
  );
}
