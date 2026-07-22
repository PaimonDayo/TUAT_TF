"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { NoticeCard } from "@/components/cards/NoticeCard";
import { NoticeFilterButton } from "@/components/features/NoticeFilterButton";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import { jstToday } from "@/lib/date";
import {
  EMPTY_NOTICE_FILTERS,
  noticeContentSnippet,
  noticeFilterCount,
  noticeMatchesFilters,
  noticeMatchesSearch,
  noticeSearchTokens,
  type NoticeFilters,
} from "@/lib/notice-filters";
import { NotificationsList } from "./NotificationsList";
import type { NoticeCategory, NoticeWithReactions, AppNotificationWithActor, Profile } from "@/types";

export function NoticesClient({
  profile,
  notices,
  notifications,
  canCreateNotice,
}: {
  profile: Pick<Profile, "id" | "roles">;
  notices: NoticeWithReactions[];
  notifications: AppNotificationWithActor[];
  canCreateNotice: boolean;
}) {
  const [tab, setTab] = useState<"notice" | "for_you">("notice");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<NoticeFilters>(EMPTY_NOTICE_FILTERS);
  const pendingScroll = useRef<string | null>(null);
  const tokens = useMemo(() => noticeSearchTokens(query), [query]);
  const activeFilterCount = noticeFilterCount(filters);
  const hasConditions = tokens.length > 0 || activeFilterCount > 0;
  const filteredNotices = useMemo(() => {
    const today = jstToday();
    return notices.filter(
      (notice) => noticeMatchesSearch(notice, tokens) && noticeMatchesFilters(notice, filters, today),
    );
  }, [filters, notices, tokens]);

  function resetConditions() {
    setQuery("");
    setFilters(EMPTY_NOTICE_FILTERS);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 通知から特定のお知らせを開く: お知らせタブへ切替＋展開＋スクロール */
  function openNotice(id: string) {
    resetConditions();
    setExpanded((prev) => new Set(prev).add(id));
    setTab("notice");
    pendingScroll.current = id;
  }

  useEffect(() => {
    if (window.location.hash === "#notifications") {
      const id = window.setTimeout(() => setTab("for_you"), 0);
      return () => window.clearTimeout(id);
    }
    const match = window.location.hash.match(/^#notice-(.+)$/);
    if (!match) return;
    const id = window.setTimeout(() => {
      setTab("notice");
      setExpanded((current) => new Set(current).add(match[1]));
      pendingScroll.current = match[1];
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  // タブ切替・展開反映後に対象カードへスクロール
  useEffect(() => {
    if (tab !== "notice" || !pendingScroll.current) return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => {
      document
        .getElementById(`notice-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [tab, expanded]);

  return (
    <div className="space-y-4">
      <div className="px-4 mt-2">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          items={[
            { key: "notice", label: "お知らせ" },
            { key: "for_you", label: "あなたへ" },
          ]}
        />
      </div>

      {tab === "notice" && (
        <div className="space-y-2 px-4">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
                placeholder="キーワードで検索"
                aria-label="お知らせを検索"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="検索語を消去"
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted active:bg-bg"
                >
                  <X size={17} />
                </button>
              )}
            </div>
            <NoticeFilterButton
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(EMPTY_NOTICE_FILTERS)}
            />
          </div>

          {activeFilterCount > 0 && (
            <ActiveFilterChips filters={filters} onChange={setFilters} />
          )}

          <div className="flex min-h-7 items-center justify-between gap-3 px-1" aria-live="polite">
            <p className="text-micro text-muted">
              {hasConditions ? `${filteredNotices.length}件 / 全${notices.length}件` : `全${notices.length}件`}
            </p>
            {hasConditions && (
              <button type="button" onClick={resetConditions} className="text-xs font-semibold text-accent active:opacity-60">
                すべて解除
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-4 space-y-3 pb-8">
        {tab === "notice" &&
          (filteredNotices.length === 0 ? (
            <EmptyState
              title={hasConditions ? "条件に一致するお知らせはありません" : "お知らせはありません"}
              description={hasConditions ? "検索語や絞り込み条件を変えてください" : undefined}
              action={hasConditions ? (
                <Button type="button" variant="outline" onClick={resetConditions}>条件をすべて解除</Button>
              ) : undefined}
            />
          ) : (
            filteredNotices.map((n) => (
              <NoticeCard
                key={n.id}
                notice={n}
                userId={profile.id}
                canManage={canCreateNotice}
                expanded={expanded.has(n.id)}
                onToggle={() => toggleExpand(n.id)}
                searchTokens={tokens}
                searchSnippet={noticeContentSnippet(n, tokens)}
              />
            ))
          ))}

        {tab === "for_you" && (
          <NotificationsList
            initialNotifications={notifications}
            onOpenNotice={openNotice}
          />
        )}
      </div>
    </div>
  );
}

function ActiveFilterChips({
  filters,
  onChange,
}: {
  filters: NoticeFilters;
  onChange: (filters: NoticeFilters) => void;
}) {
  const deadlineLabels = { open: "受付中", ended: "終了", none: "期限なし" } as const;
  const acknowledgementLabels = { unacknowledged: "未確認", acknowledged: "確認済み" } as const;

  return (
    <div className="flex flex-wrap gap-1.5">
      {filters.categories.map((category: NoticeCategory) => (
        <FilterChip
          key={category}
          label={NOTICE_CATEGORIES[category].label}
          onRemove={() => onChange({
            ...filters,
            categories: filters.categories.filter((item) => item !== category),
          })}
        />
      ))}
      {filters.deadline !== "all" && (
        <FilterChip
          label={deadlineLabels[filters.deadline]}
          onRemove={() => onChange({ ...filters, deadline: "all" })}
        />
      )}
      {filters.acknowledgement !== "all" && (
        <FilterChip
          label={acknowledgementLabels[filters.acknowledgement]}
          onRemove={() => onChange({ ...filters, acknowledgement: "all" })}
        />
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`${label}の絞り込みを外す`}
      className="inline-flex h-7 items-center gap-1 rounded-full bg-accent/10 px-2.5 text-[12px] font-semibold text-accent active:opacity-60"
    >
      {label}
      <X size={12} />
    </button>
  );
}
