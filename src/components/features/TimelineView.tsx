"use client";

import { useMemo, useState } from "react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { GradeFilter } from "@/components/features/GradeFilter";
import { SIMPLE_BLOCK_ITEMS, matchSimpleBlock } from "@/lib/constants";
import { loadFeed } from "@/app/(app)/timeline/actions";
import type { FeedItem } from "@/types";

const PAGE = 30;

/**
 * タイムライン本体。ブロック・学年の絞り込みはサーバー往復せず
 * 読み込み済みアイテムをクライアント側でフィルタするため、タブ切替が即時。
 * 「もっと見る」のときだけサーバーから追加取得する。
 */
export function TimelineView({
  initialItems,
  currentUserId,
}: {
  initialItems: FeedItem[];
  currentUserId: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(initialItems.length < PAGE);

  const [block, setBlock] = useState<string>("all");
  const [grade, setGrade] = useState<string>("all");

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!matchSimpleBlock(item.author?.blocks, block)) return false;
      if (grade !== "all" && item.author?.grade !== grade) return false;
      return true;
    });
  }, [items, block, grade]);

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
        <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
      </div>
      <div className="px-4 pb-2 flex justify-end">
        <GradeFilter value={grade} onChange={setGrade} />
      </div>

      <div className="px-4 pt-1">
        {filtered.length === 0 ? (
          <p className="text-caption text-center py-16">条件に合う投稿がありません。</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) =>
              item.kind === "record" ? (
                <RecordCard key={`r-${item.id}`} record={item} currentUserId={currentUserId} />
              ) : (
                <TweetCard key={`t-${item.id}`} tweet={item} currentUserId={currentUserId} />
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
