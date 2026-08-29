"use client";

import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { EmptyState } from "@/components/ui/empty-state";
import type { CommentAuthor, FeedItem } from "@/types";

/**
 * ホームのタイムライン。表示の切り替えは持たず、長い投稿だけがカード内で畳まれる
 * （タイムライン・マイページと同じ見え方）。
 */
export function HomeFeed({
  feed,
  currentUser,
  showRecordSource = false,
}: {
  feed: FeedItem[];
  currentUser: CommentAuthor;
  showRecordSource?: boolean;
}) {
  if (feed.length === 0) {
    return <EmptyState title="まだ投稿はありません" />;
  }

  return (
    <div className="space-y-3">
      {feed.map((item) =>
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
