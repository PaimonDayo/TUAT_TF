"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { GradeFilter } from "@/components/features/GradeFilter";
import { UnreadDivider } from "@/components/features/UnreadDivider";
import { FAVORITE_CHANGE_EVENT } from "@/components/features/FavoriteButton";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui/empty-state";
import { GRADE_OPTIONS, SIMPLE_BLOCK_ITEMS, matchSimpleBlock } from "@/lib/constants";
import { jstToday } from "@/lib/date";
import {
  feedDateLabel,
  groupFeedItemsByDate,
  uniqueFeedItems,
} from "@/lib/feed-date";
import { cn } from "@/lib/utils";
import { loadFeed } from "@/app/(app)/timeline/actions";
import { useLastSeenFeed } from "@/hooks/use-last-seen-feed";
import { unreadBoundaryIndex } from "@/lib/feed-unread";
import type { BlockViewDefault, CommentAuthor, FeedItem } from "@/types";

const PAGE = 90;
const FILTER_AUTOLOAD_PAGES = 5;
type FeedCursor = {
  record?: { createdAt: string; id: string };
  tweet?: { createdAt: string; id: string };
} | null;

/**
 * タイムライン本体。表示の切り替えは持たず、長い投稿だけがカード内で畳まれる。
 * 前回開いたときの続きの位置に「ここまで読みました」の線を出す。
 * ブロック・学年・お気に入りの絞り込みはサーバー往復せず
 * 読み込み済みアイテムをクライアント側でフィルタするため、タブ切替が即時。
 * 「もっと見る」のときだけサーバーから追加取得する。
 */
export function TimelineView({
  initialItems,
  currentUser,
  favoriteIds = [],
  initialBlock = "all",
  showRecordSource = false,
  enableCsvRefresh = false,
}: {
  initialItems: FeedItem[];
  currentUser: CommentAuthor;
  favoriteIds?: string[];
  /** 最初に表示するブロックタブ（マイページの「タイムラインの初期表示」） */
  initialBlock?: BlockViewDefault;
  showRecordSource?: boolean;
  enableCsvRefresh?: boolean;
}) {
  const feedQuery = useInfiniteQuery({
    queryKey: ["timeline", currentUser.id],
    queryFn: ({ pageParam }) => loadFeed(pageParam ?? {}, PAGE),
    initialPageParam: null as FeedCursor,
    initialData: { pages: [initialItems], pageParams: [null as FeedCursor] },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
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


  const items = useMemo(
    () => uniqueFeedItems(feedQuery.data.pages.flat()),
    [feedQuery.data.pages],
  );
  const refetchFeed = feedQuery.refetch;
  const visibleLikeTargets = useMemo(
    () => new Set(items.map((item) => `${item.kind}:${item.id}`)),
    [items],
  );

  const [block, setBlock] = useState<string>(initialBlock);
  const [grades, setGrades] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const [currentFavoriteIds, setCurrentFavoriteIds] = useState(favoriteIds);
  const filterAutoLoadCount = useRef(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("favorites")
      .select("favorite_user_id")
      .eq("user_id", currentUser.id)
      .then(({ data }) => {
        if (active) setCurrentFavoriteIds((data ?? []).map((row) => row.favorite_user_id as string));
      });

    function handleFavoriteChange(event: Event) {
      const { targetId, favorited } = (event as CustomEvent<{ targetId: string; favorited: boolean }>).detail;
      setCurrentFavoriteIds((ids) => favorited
        ? Array.from(new Set([...ids, targetId]))
        : ids.filter((id) => id !== targetId));
    }
    window.addEventListener(FAVORITE_CHANGE_EVENT, handleFavoriteChange);
    return () => {
      active = false;
      window.removeEventListener(FAVORITE_CHANGE_EVENT, handleFavoriteChange);
    };
  }, [currentUser.id]);

  // 他の利用者が押したいいねも、画面を開いたまま反映する。
  // 投稿ごとの購読ではなく likes テーブルを一つだけ購読し、今表示している投稿に
  // 関係する変更だけをまとめて再取得することで、購読数と通信回数を抑える。
  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = (payload: {
      new: { target_type?: string; target_id?: string };
      old: { target_type?: string; target_id?: string };
    }) => {
      const target = payload.new.target_id
        ? payload.new
        : payload.old;
      if (
        (target.target_type !== "record" && target.target_type !== "tweet") ||
        !target.target_id ||
        !visibleLikeTargets.has(`${target.target_type}:${target.target_id}`)
      ) return;

      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refetchFeed();
      }, 150);
    };

    const channel = supabase
      .channel(`timeline-likes-${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "likes" },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [currentUser.id, refetchFeed, visibleLikeTargets]);

  useEffect(() => {
    if (!enableCsvRefresh) return;
    const refreshKey = `timeline-csv-refresh:${currentUser.id}`;
    const lastRefresh = Number(sessionStorage.getItem(refreshKey) ?? "0");
    if (Date.now() - lastRefresh < 15_000) return;
    sessionStorage.setItem(refreshKey, String(Date.now()));
    let active = true;

    void (async () => {
      // 初期表示はDBだけで即時に行い、その後システム管理者本人のCSVを同期する。
      // 変更があればタイムラインを自動再取得する。
      for (let attempt = 0; active && attempt < 12; attempt++) {
        try {
          const response = await fetch("/api/sheets/timeline-refresh", { method: "POST", cache: "no-store" });
          const result = await response.json() as { ok?: boolean; changed?: boolean; cycleComplete?: boolean };
          if (!active || !response.ok || !result.ok) return;
          if (result.changed) await refetchFeed();
          if (result.cycleComplete) return;
        } catch {
          return;
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [currentUser.id, enableCsvRefresh, refetchFeed]);

  const favSet = useMemo(() => new Set(currentFavoriteIds), [currentFavoriteIds]);

  // 投稿者にいる学年だけをフィルタ候補に出す（メンバー一覧と同じ仕様）
  const presentGrades = useMemo(() => {
    const set = new Set(items.map((i) => i.author?.grade ?? "").filter(Boolean));
    return GRADE_OPTIONS.map((g) => g.value).filter((v) => set.has(v));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!matchSimpleBlock(item.author?.blocks, block)) return false;
      if (grades.length > 0 && !grades.includes(item.author?.grade ?? "")) return false;
      if (favOnly && !favSet.has(item.author?.id)) return false;
      return true;
    });
  }, [items, block, grades, favOnly, favSet]);

  const groups = useMemo(() => groupFeedItemsByDate(filtered), [filtered]);
  // 既読の基準は「実際に画面へ出した投稿」。絞り込みで隠れている投稿は既読にしない。
  const lastSeenAt = useLastSeenFeed(currentUser.id, filtered);
  // 絞り込み後の並びで数えた「ここまで読みました」の位置（-1 のときは線を出さない）
  const boundaryIndex = useMemo(
    () => unreadBoundaryIndex(filtered, lastSeenAt),
    [filtered, lastSeenAt],
  );

  const hasActiveFilter = block !== "all" || grades.length > 0 || favOnly;

  useEffect(() => {
    filterAutoLoadCount.current = 0;
  }, [block, grades, favOnly]);

  useEffect(() => {
    if (
      !hasActiveFilter ||
      filtered.length >= PAGE ||
      !feedQuery.hasNextPage ||
      feedQuery.isFetchingNextPage ||
      filterAutoLoadCount.current >= FILTER_AUTOLOAD_PAGES
    ) return;

    filterAutoLoadCount.current += 1;
    void feedQuery.fetchNextPage();
  }, [
    feedQuery,
    filtered.length,
    hasActiveFilter,
  ]);

  function loadMore() { void feedQuery.fetchNextPage(); }

  function renderItem(item: FeedItem) {
    return item.kind === "record" ? (
      <RecordCard record={item} currentUser={currentUser} showSource={showRecordSource} />
    ) : (
      <TweetCard tweet={item} currentUser={currentUser} />
    );
  }

  return (
    <>
      <div className="px-4 pt-1 pb-3 md:px-6 lg:pb-2">
        <div className="flex min-h-9 items-center gap-2 lg:min-h-8">
          <div className="min-w-0 flex-1 md:max-w-[420px]"><SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} /></div>
          <GradeFilter value={grades} onChange={setGrades} availableGrades={presentGrades} />
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
        </div>
      </div>


      <div className="px-4 pt-1 md:px-6">
        {filtered.length === 0 ? (
          <EmptyState title="条件に合う投稿はありません" description="条件を変えてみてください。" />
        ) : (
          <div className="space-y-3 lg:space-y-2">
            {(() => {
              let offset = 0;
              return groups.map((group) => {
                const groupStart = offset;
                offset += group.items.length;
                return (
                  <section key={group.date} aria-labelledby={`feed-date-${group.date}`}>
                    {boundaryIndex === groupStart && <UnreadDivider />}
                    <div className="mb-1.5 flex items-center gap-1.5 px-1">
                      <h2
                        id={`feed-date-${group.date}`}
                        className="text-[12px] font-semibold text-muted2"
                      >
                        {feedDateLabel(group.date, jstToday(), jstToday(-1))}
                      </h2>
                      <span className="text-[10px] text-muted">・{group.items.length}件</span>
                    </div>
                    <div className="space-y-3 lg:space-y-2">
                      {group.items.map((item, index) => (
                        <Fragment key={`${item.kind}-${item.id}`}>
                          {index > 0 && boundaryIndex === groupStart + index && <UnreadDivider />}
                          {renderItem(item)}
                        </Fragment>
                      ))}
                    </div>
                  </section>
                );
              });
            })()}

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
