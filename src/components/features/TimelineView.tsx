"use client";

import { useEffect, useMemo, useState } from "react";
import { UserCheck, List } from "lucide-react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { GradeMenu } from "@/components/features/GradeMenu";
import { EmptyState } from "@/components/ui/empty-state";
import { SIMPLE_BLOCK_ITEMS, matchSimpleBlock } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { loadFeed } from "@/app/(app)/timeline/actions";
import type { CommentAuthor, FeedItem } from "@/types";

const PAGE = 30;

/**
 * タイムライン本体。ブロック・学年・お気に入りの絞り込みはサーバー往復せず
 * 読み込み済みアイテムをクライアント側でフィルタするため、タブ切替が即時。
 * 「もっと見る」のときだけサーバーから追加取得する。
 */
export function TimelineView({
  initialItems,
  currentUser,
  favoriteIds = [],
}: {
  initialItems: FeedItem[];
  currentUser: CommentAuthor;
  favoriteIds?: string[];
}) {
  const [items, setItems] = useState(initialItems);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(initialItems.length < PAGE);

  const [block, setBlock] = useState<string>("all");
  const [grades, setGrades] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  // 簡易表示の設定はタブを離れても保持する（localStorage）
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    setCompact(localStorage.getItem("timeline-compact") === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem("timeline-compact", compact ? "1" : "0");
  }, [compact]);

  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!matchSimpleBlock(item.author?.blocks, block)) return false;
      if (grades.length > 0 && !grades.includes(item.author?.grade ?? "")) return false;
      if (favOnly && !favSet.has(item.author?.id)) return false;
      return true;
    });
  }, [items, block, grades, favOnly, favSet]);

  async function loadMore() {
    setLoading(true);
    const nextLimit = limit + PAGE;
    const res = await loadFeed("all", "all", nextLimit);
    setItems(res);
    setLimit(nextLimit);
    setEnded(res.length < nextLimit);
    setLoading(false);
  }

  return (
    <>
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
          </div>
          <GradeMenu value={grades} onChange={setGrades} />
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
            onClick={() => setCompact((v) => !v)}
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
            {filtered.map((item) =>
              item.kind === "record" ? (
                <RecordCard key={`r-${item.id}`} record={item} currentUser={currentUser} compact={compact} />
              ) : (
                <TweetCard key={`t-${item.id}`} tweet={item} currentUser={currentUser} compact={compact} />
              ),
            )}

            {!ended && (
              <div className="pt-1 pb-2">
                <Button variant="outline" size="lg" onClick={loadMore} disabled={loading}>
                  {loading ? "読み込み中…" : "もっと見る"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
