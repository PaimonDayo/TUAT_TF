"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { UserCheck, List } from "lucide-react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { Button } from "@/components/ui/button";
import { PeopleFilterButton } from "@/components/features/PeopleFilterButton";
import { EmptyState } from "@/components/ui/empty-state";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { loadFeed } from "@/app/(app)/timeline/actions";
import { useFeedDisplay } from "@/hooks/use-feed-display";
import type { Block, CommentAuthor, FeedItem } from "@/types";

const PAGE = 30;
type FeedCursor = {
  record?: { createdAt: string; id: string };
  tweet?: { createdAt: string; id: string };
} | null;

/**
 * タイムライン本体。ブロック・学年・お気に入りの絞り込みはサーバー往復せず
 * 読み込み済みアイテムをクライアント側でフィルタするため、タブ切替が即時。
 * 「もっと見る」のときだけサーバーから追加取得する。
 */
export function TimelineView({
  initialItems,
  currentUser,
  favoriteIds = [],
  initialCompact = false,
}: {
  initialItems: FeedItem[];
  currentUser: CommentAuthor;
  favoriteIds?: string[];
  /** 簡易表示の初期値（サーバーが cookie から復元して渡す。詳細→簡易のフラッシュ防止） */
  initialCompact?: boolean;
}) {
  const feedQuery = useInfiniteQuery({
    queryKey: ["timeline", currentUser.id],
    queryFn: ({ pageParam }) => loadFeed(pageParam ?? {}, PAGE),
    initialPageParam: null as FeedCursor,
    initialData: { pages: [initialItems], pageParams: [null as FeedCursor] },
    getNextPageParam: (lastPage): FeedCursor | undefined => {
      if (lastPage.length < PAGE) return undefined;
      const lastRecord = lastPage.findLast((item) => item.kind === "record");
      const lastTweet = lastPage.findLast((item) => item.kind === "tweet");
      if (!lastRecord && !lastTweet) return undefined;
      return {
        record: lastRecord ? { createdAt: lastRecord.created_at, id: lastRecord.id } : undefined,
        tweet: lastTweet ? { createdAt: lastTweet.created_at, id: lastTweet.id } : undefined,
      };
    },
  });
  const items = feedQuery.data.pages.flat();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const { compact, toggleCompact, toggleExpanded, isCompact } = useFeedDisplay({
    initialCompact,
    cookieName: "timeline-compact",
  });

  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // 投稿者にいる学年だけをフィルタ候補に出す（メンバー一覧と同じ仕様）
  const presentGrades = useMemo(() => {
    const set = new Set(items.map((i) => i.author?.grade ?? "").filter(Boolean));
    return GRADE_OPTIONS.map((g) => g.value).filter((v) => set.has(v));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (blocks.length > 0 && !(item.author?.blocks ?? []).some((itemBlock) => blocks.includes(itemBlock))) return false;
      if (grades.length > 0 && !grades.includes(item.author?.grade ?? "")) return false;
      if (favOnly && !favSet.has(item.author?.id)) return false;
      return true;
    });
  }, [items, blocks, grades, favOnly, favSet]);

  function loadMore() { void feedQuery.fetchNextPage(); }

  return (
    <>
      <div className="px-4 pt-1 pb-3">
        <div className="flex min-h-9 items-center gap-2">
          <div className="min-w-0 flex-1"><PeopleFilterButton blocks={blocks} grades={grades} onBlocksChange={setBlocks} onGradesChange={setGrades} availableGrades={presentGrades} /></div>
          <button
            onClick={() => setFavOnly((v) => !v)}
            aria-label={favOnly ? "フォロー中のみを解除" : "フォロー中のみ表示"}
            title="フォロー中"
            className={cn(
              "h-8 w-8 rounded-full border inline-flex items-center justify-center shrink-0 active:opacity-60",
              favOnly ? "bg-accent text-white border-accent" : "bg-card border-separator text-muted2",
            )}
          >
            <UserCheck size={14} />
          </button>
          <button
            onClick={toggleCompact}
            aria-label={compact ? "詳細表示にする" : "簡易表示にする"}
            title={compact ? "詳細表示" : "簡易表示"}
            className={cn(
              "h-8 w-8 rounded-full border inline-flex items-center justify-center shrink-0 active:opacity-60",
              compact ? "bg-accent text-white border-accent" : "bg-card border-separator text-muted2",
            )}
          >
            <List size={15} />
          </button>
        </div>
      </div>


      <div className="px-4 pt-1">
        {filtered.length === 0 ? (
          <EmptyState title="条件に合う投稿がありません" />
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => {
              const key = `${item.kind}-${item.id}`;
              // 簡易表示は既定。個別にタップで展開でき、もう一度タップで閉じる。
              const effectiveCompact = isCompact(key);
              const card =
                item.kind === "record" ? (
                  <RecordCard record={item} currentUser={currentUser} compact={effectiveCompact} />
                ) : (
                  <TweetCard tweet={item} currentUser={currentUser} compact={effectiveCompact} />
                );
              // 簡易表示のときだけ開閉トグルを付ける（詳細表示は常に展開済み）
              return compact ? (
                <div key={key} onClick={() => toggleExpanded(key)} className="cursor-pointer">
                  {card}
                </div>
              ) : (
                <div key={key}>{card}</div>
              );
            })}

            {feedQuery.hasNextPage && (
              <div className="pt-1 pb-2">
                <Button variant="outline" size="lg" onClick={loadMore} disabled={feedQuery.isFetchingNextPage}>
                  {feedQuery.isFetchingNextPage ? "読み込み中…" : "もっと見る"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
