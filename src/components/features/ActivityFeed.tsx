"use client";

import { List } from "lucide-react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { cn } from "@/lib/utils";
import { useFeedDisplay } from "@/hooks/use-feed-display";
import type { CommentAuthor, FeedItem } from "@/types";

/**
 * 投稿一覧（記録＋つぶやき）。タイムラインと同じく簡易表示トグル＋タップ展開に対応。
 * マイページの「これまでの投稿」で使用。
 */
export function ActivityFeed({
  activity,
  currentUser,
}: {
  activity: FeedItem[];
  currentUser: CommentAuthor;
}) {
  const { compact, toggleCompact, toggleExpanded, isCompact } = useFeedDisplay({
    initialCompact: false,
  });

  return (
    <>
      <div className="flex justify-end pb-2">
        <button
          type="button"
          onClick={toggleCompact}
          aria-label={compact ? "詳細表示にする" : "簡易表示にする"}
          title={compact ? "詳細表示" : "簡易表示"}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full border active:opacity-60",
            compact ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted2",
          )}
        >
          <List size={15} />
        </button>
      </div>
      <div className="space-y-3">
        {activity.map((item) => {
          const key = `${item.kind}-${item.id}`;
          const effectiveCompact = isCompact(key);
          const card =
            item.kind === "record" ? (
              <RecordCard record={item} currentUser={currentUser} compact={effectiveCompact} />
            ) : (
              <TweetCard tweet={item} currentUser={currentUser} compact={effectiveCompact} />
            );
          return compact ? (
            <div key={key} onClick={() => toggleExpanded(key)} className="cursor-pointer">
              {card}
            </div>
          ) : (
            <div key={key}>{card}</div>
          );
        })}
      </div>
    </>
  );
}
