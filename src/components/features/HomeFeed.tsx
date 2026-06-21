"use client";

import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { EmptyState } from "@/components/ui/empty-state";
import { useFeedDisplay } from "@/hooks/use-feed-display";
import type { CommentAuthor, FeedItem } from "@/types";

/**
 * ホームのタイムライン。初期は簡易表示で並べ、カードをタップすると
 * そのカードだけ詳細表示に展開する。
 */
export function HomeFeed({
  feed,
  currentUser,
}: {
  feed: FeedItem[];
  currentUser: CommentAuthor;
}) {
  const { toggleExpanded, isCompact } = useFeedDisplay({ initialCompact: true });

  if (feed.length === 0) {
    return <EmptyState title="まだ投稿がありません" />;
  }

  return (
    <div className="space-y-3">
      {feed.map((item) => {
        const key = `${item.kind}-${item.id}`;
        const compact = isCompact(key);
        const card =
          item.kind === "record" ? (
            <RecordCard record={item} currentUser={currentUser} compact={compact} />
          ) : (
            <TweetCard tweet={item} currentUser={currentUser} compact={compact} />
          );

        // カードのどこをタップしても開閉する（もう一度タップで閉じる）。
        // いいね・コメント・⋯・名前リンクはカード側で伝播を止めてあるので誤爆しない。
        return (
          <div key={key} onClick={() => toggleExpanded(key)} className="cursor-pointer">
            {card}
          </div>
        );
      })}
    </div>
  );
}
