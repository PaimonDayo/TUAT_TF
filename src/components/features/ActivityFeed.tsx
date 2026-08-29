"use client";

import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import type { CommentAuthor, FeedItem } from "@/types";

/**
 * 投稿一覧（記録＋つぶやき）。マイページ・部員ページの「これまでの投稿」で使用。
 * 表示の切り替えは持たず、長い投稿だけがカード内で畳まれる。
 */
export function ActivityFeed({
  activity,
  currentUser,
  showRecordSource = false,
}: {
  activity: FeedItem[];
  currentUser: CommentAuthor;
  showRecordSource?: boolean;
}) {
  return (
    <div className="space-y-3">
      {activity.map((item) =>
        item.kind === "record" ? (
          <RecordCard
            key={`record-${item.id}`}
            record={item}
            currentUser={currentUser}
            showSource={showRecordSource}
          />
        ) : (
          <TweetCard key={`tweet-${item.id}`} tweet={item} currentUser={currentUser} />
        ),
      )}
    </div>
  );
}
