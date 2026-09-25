"use client";

import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { formatKm } from "@/lib/utils";
import type { QuotedPost } from "@/types";

/**
 * 引用した投稿の中に出る、引用元の小さなカード。押すと引用元を開く。
 * 引用元は外部キーではないので、消えていれば消えたことだけを出す。
 */
export function QuotedPostCard({ quoted, linked = true }: { quoted: QuotedPost; linked?: boolean }) {
  if (quoted.kind === "missing") {
    return (
      <p className="rounded-card border border-separator bg-bg/60 px-3 py-2.5 text-caption">
        この投稿は削除されました
      </p>
    );
  }

  const subtitle = quoted.kind === "record"
    ? `${format(new Date(quoted.recorded_date + "T00:00:00"), "M月d日(E)", { locale: ja })}の練習`
    : formatDistanceToNow(new Date(quoted.created_at), { addSuffix: true, locale: ja });
  const distance = quoted.kind === "record" && quoted.distanceKm > 0 ? `${formatKm(quoted.distanceKm)}km` : null;
  const text = quoted.kind === "record" ? quoted.summary : quoted.content;

  const body = (
    <div className="rounded-card border border-separator bg-bg/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Avatar
          name={quoted.author.display_name}
          avatarUrl={quoted.author.avatar_url}
          blocks={quoted.author.blocks}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {quoted.author.display_name || "名無し"}
        </span>
        <span className="shrink-0 text-micro">{subtitle}</span>
      </div>
      {(distance || text) && (
        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-muted2">
          {distance && <span className="font-semibold text-ink">{distance}</span>}
          {distance && text ? " " : ""}
          {text}
        </p>
      )}
      {quoted.kind === "tweet" && quoted.hasImage && (
        <p className="mt-1.5 text-micro">画像つきの投稿</p>
      )}
    </div>
  );

  if (!linked) return body;
  return (
    <Link
      href={`/timeline/${quoted.kind}/${quoted.id}`}
      prefetch={false}
      onClick={(event) => event.stopPropagation()}
      className="block pressable"
    >
      {body}
    </Link>
  );
}
