"use client";

import Link from "next/link";
import { Heart, MessageCircle } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { BLOCKS, CONDITIONS, gradeShort } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/types";

function compactRecordSummary(item: Extract<FeedItem, { kind: "record" }>) {
  const totalDistance =
    item.dist_low + item.dist_mid + item.dist_high + item.dist_speed;
  const detail =
    item.menu_text ||
    item.result_text ||
    item.memo ||
    item.focus_text ||
    item.strength_text ||
    Object.values(item.custom ?? {}).find(
      (value) => value !== null && String(value).trim() !== "",
    );

  return {
    distance: totalDistance > 0 ? String(Math.round(totalDistance * 10) / 10) + "km" : null,
    detail: detail ? String(detail) : "練習記録",
  };
}

function tweetTime(createdAt: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(createdAt));
}

/** 一覧性を優先した、簡易表示専用の2行フィード行。 */
export function CompactFeedRow({ item }: { item: FeedItem }) {
  const author = item.author;
  const primaryBlock = author.blocks?.[0];
  const block = primaryBlock ? BLOCKS[primaryBlock] : null;
  const grade = gradeShort(author.grade);
  const condition =
    item.kind === "record" && item.condition ? CONDITIONS[item.condition] : null;
  const likes = item.likes_count;
  const comments = item.comments_count ?? 0;
  const recordSummary = item.kind === "record" ? compactRecordSummary(item) : null;

  return (
    <div className="flex min-h-[70px] gap-2.5 bg-card px-3 py-2.5">
      <Link
        href={"/members/" + author.id}
        onClick={(event) => event.stopPropagation()}
        className="self-start"
        aria-label={author.display_name + "のプロフィール"}
      >
        <Avatar
          name={author.display_name}
          blocks={author.blocks}
          avatarUrl={author.avatar_url}
          size="sm"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={"/members/" + author.id}
            onClick={(event) => event.stopPropagation()}
            className="truncate text-[13px] font-semibold text-foreground"
          >
            {author.display_name || "名無し"}
          </Link>
          {grade && <span className="shrink-0 text-[10px] text-muted2">{grade}</span>}
          {block && (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
              style={{ backgroundColor: block.bg, color: block.color }}
            >
              {block.short}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-muted2">
            {item.kind === "tweet" ? tweetTime(item.created_at) : "練習"}
          </span>
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          {recordSummary?.distance && (
            <span className="shrink-0 text-[13px] font-bold tabular-nums">
              {recordSummary.distance}
            </span>
          )}
          {condition && (
            <span
              className="shrink-0 text-[13px] font-bold"
              style={{ color: condition.color }}
              title={condition.label}
            >
              {condition.symbol}
            </span>
          )}
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-[12px]",
              item.kind === "tweet" ? "text-foreground" : "text-muted2",
            )}
          >
            {item.kind === "tweet" ? item.content : recordSummary?.detail}
          </p>

          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 text-[10px]",
              item.liked_by_me ? "text-danger" : "text-muted2",
            )}
            aria-label={"いいね" + likes + "件"}
          >
            <Heart size={13} fill={item.liked_by_me ? "currentColor" : "none"} />
            {likes > 0 && <span className="tabular-nums">{likes}</span>}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted2"
            aria-label={"返信" + comments + "件"}
          >
            <MessageCircle size={13} />
            {comments > 0 && <span className="tabular-nums">{comments}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
