"use client";

import { useState } from "react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { EmptyState } from "@/components/ui/empty-state";
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (feed.length === 0) {
    return <EmptyState title="まだ投稿がありません" />;
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {feed.map((item) => {
        const key = `${item.kind}-${item.id}`;
        const isOpen = expanded.has(key);
        const card =
          item.kind === "record" ? (
            <RecordCard record={item} currentUser={currentUser} compact={!isOpen} />
          ) : (
            <TweetCard tweet={item} currentUser={currentUser} compact={!isOpen} />
          );

        // 展開後は内部のいいね等を操作できるよう、簡易表示のときだけタップで展開する
        return isOpen ? (
          <div key={key}>{card}</div>
        ) : (
          <div key={key} onClick={() => toggle(key)} className="cursor-pointer">
            {card}
          </div>
        );
      })}
    </div>
  );
}
