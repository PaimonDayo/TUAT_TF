"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, Check } from "lucide-react";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { BLOCK_ORDER, BLOCKS, GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { loadFeed } from "@/app/(app)/timeline/actions";
import type { Block, FeedItem } from "@/types";

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
      if (block !== "all" && !item.author?.blocks?.includes(block as Block)) return false;
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

  const blockItems = [
    { key: "all", label: "すべて" },
    ...BLOCK_ORDER.map((b) => ({ key: b, label: BLOCKS[b].short })),
  ];

  return (
    <>
      <div className="px-4 pb-2">
        <SegmentedControl items={blockItems} value={block} onChange={setBlock} />
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

/** 学年フィルタ（クライアント状態版。タブを増やさないコンパクトボタン＋シート） */
function GradeFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== "all";
  const label = active ? GRADE_OPTIONS.find((g) => g.value === value)?.short ?? "学年" : "学年";

  function select(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 px-3 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1 shrink-0 active:opacity-60",
          active ? "bg-accent text-white border-accent" : "bg-card border-separator text-muted2",
        )}
      >
        <SlidersHorizontal size={14} />
        {label}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="学年でしぼり込み">
          <div className="pb-4 grid grid-cols-3 gap-2">
            <GradeChip label="すべて" active={value === "all"} onClick={() => select("all")} />
            {GRADE_OPTIONS.map((g) => (
              <GradeChip
                key={g.value}
                label={g.short}
                active={value === g.value}
                onClick={() => select(g.value)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function GradeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-11 rounded-xl border text-[14px] font-semibold inline-flex items-center justify-center gap-1 transition-active active:scale-[0.98]",
        active ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted",
      )}
    >
      {active && <Check size={15} />}
      {label}
    </button>
  );
}
