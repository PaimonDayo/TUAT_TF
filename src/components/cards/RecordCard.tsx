"use client";

import Link from "next/link";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/key-value";
import { IntensityBar } from "@/components/features/IntensityBar";
import { PostActions } from "@/components/cards/PostActions";
import { RecordOwnerMenu } from "@/components/cards/PostOwnerMenu";
import { CONDITIONS, gradeShort } from "@/lib/constants";
import type { CommentAuthor, RecordWithAuthor } from "@/types";

/** タイムライン用の練習記録カード。compact=簡易表示（テキスト詳細を畳む） */
export function RecordCard({
  record,
  currentUser,
  compact = false,
}: {
  record: RecordWithAuthor;
  currentUser: CommentAuthor;
  compact?: boolean;
}) {
  const { author } = record;
  const cond = record.condition ? CONDITIONS[record.condition] : null;
  const isOwner = currentUser.id === author.id;
  const gradeLabel = gradeShort(author.grade);
  const totalDistance =
    record.dist_low + record.dist_mid + record.dist_high + record.dist_speed;

  return (
    <Card className="p-4 space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center gap-2.5">
        <Link href={`/members/${author.id}`} onClick={(e) => e.stopPropagation()}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              href={`/members/${author.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-headline truncate"
            >
              {author.display_name || "名無し"}
            </Link>
            <BlockPills blocks={author.blocks} />
            {gradeLabel && <span className="text-micro">{gradeLabel}</span>}
          </div>
          <p className="text-caption">
            {format(new Date(record.recorded_date + "T00:00:00"), "M月d日(E)", { locale: ja })}
            の練習
          </p>
        </div>
        {cond && (
          <span
            className="inline-flex items-center gap-1 text-[13px] font-semibold shrink-0"
            style={{ color: cond.color }}
            title={cond.label}
          >
            <span className="text-[16px] leading-none">{cond.symbol}</span>
            {cond.label}
          </span>
        )}
        {isOwner && (
          <span onClick={(e) => e.stopPropagation()}>
            <RecordOwnerMenu
              record={record}
              isMiddleLong={author.blocks?.includes("middle_long") ?? false}
            />
          </span>
        )}
      </div>

      {/* 距離（中長距離。データがある時だけ表示） */}
      {compact
        ? totalDistance > 0 && (
            <p className="text-[13px] font-semibold text-muted2 tabular-nums">
              走行距離 {Math.round(totalDistance * 10) / 10}km
            </p>
          )
        : totalDistance > 0 && <IntensityBar record={record} />}
      {!compact && record.strides > 0 && (
        <p className="text-[12px] text-muted2">流し {record.strides}本</p>
      )}

      {/* テキスト各種（簡易表示では畳む。存在する項目だけ表示） */}
      {!compact &&
        (record.menu_text ||
          record.focus_text ||
          record.result_text ||
          record.strength_text ||
          record.memo) && (
          <dl>
            <KeyValue label="メニュー" value={record.menu_text} />
            <KeyValue label="目的・意識すること" value={record.focus_text} />
            <KeyValue
              label={record.menu_text || record.focus_text ? "タイム" : "結果・タイム"}
              value={record.result_text}
            />
            <KeyValue label="補強" value={record.strength_text} />
            <KeyValue label="感想" value={record.memo} />
          </dl>
        )}

      {/* いいね・返信は簡易表示でも直接押せるよう常に表示。タップで展開しないよう伝播を止める */}
      <div onClick={(e) => e.stopPropagation()}>
        <PostActions
          targetType="record"
          targetId={record.id}
          initialLikes={record.likes_count}
          initialLiked={record.liked_by_me ?? false}
          initialComments={record.comments_count ?? 0}
          currentUser={currentUser}
        />
      </div>
    </Card>
  );
}
