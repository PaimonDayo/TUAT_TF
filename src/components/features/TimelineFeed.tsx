"use client";

import { useState } from "react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { Button } from "@/components/ui/button";
import { loadFeed } from "@/app/(app)/timeline/actions";
import type { FeedItem } from "@/types";

const PAGE = 15;

/** タイムラインのフィード本体。「もっと見る」で追加読み込み */
export function TimelineFeed({
  initialItems,
  currentUserId,
  block,
  grade,
}: {
  initialItems: FeedItem[];
  currentUserId: string;
  block: string;
  grade: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(initialItems.length < PAGE);

  async function loadMore() {
    setLoading(true);
    const nextLimit = limit + PAGE;
    const res = await loadFeed(block, grade, nextLimit);
    setItems(res);
    setLimit(nextLimit);
    setEnded(res.length < nextLimit);
    setLoading(false);
  }

  if (items.length === 0) {
    return (
      <p className="text-caption text-center py-16">
        条件に合う投稿がありません。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) =>
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
  );
}
