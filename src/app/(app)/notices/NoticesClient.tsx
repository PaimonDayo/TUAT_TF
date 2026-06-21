"use client";

import { useState } from "react";
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
        {tab === "notice" && (
          notices.length === 0 ? (
            <EmptyState title="お知らせはありません" />
          ) : (
            notices.map((n) => (
              <NoticeCard
                key={n.id}
                notice={n}
                userId={profile.id}
                canManage={canCreateNotice}
              />
            ))
          )
        )}

        {tab === "for_you" && (
          <NotificationsList
            initialNotifications={notifications}
            userId={profile.id}
          />
        )}
      </div>
    </div>
  );
}
