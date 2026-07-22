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
          <div
            key={key}
            role="button"
            tabIndex={0}
            aria-label={"\u6295\u7a3f\u306e\u8a73\u7d30\u3092\u958b\u9589"}
            onClick={() => toggleExpanded(key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleExpanded(key);
              }
            }}
            className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {card}
          </div>
        );
      })}
    </div>
  );
}
