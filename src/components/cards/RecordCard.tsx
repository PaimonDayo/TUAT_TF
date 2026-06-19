import Link from "next/link";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { IntensityBar } from "@/components/features/IntensityBar";
import { PostActions } from "@/components/cards/PostActions";
import { Linkify } from "@/components/common/Linkify";
import { RecordOwnerMenu } from "@/components/cards/PostOwnerMenu";
import { CONDITIONS, gradeShort } from "@/lib/constants";
import type { CommentAuthor, RecordWithAuthor } from "@/types";

/** タイムライン用の練習記録カード */
export function RecordCard({
  record,
  currentUser,
}: {
  record: RecordWithAuthor;
  currentUser: CommentAuthor;
}) {
  const { author } = record;
  const cond = record.condition ? CONDITIONS[record.condition] : null;
  const isOwner = currentUser.id === author.id;
  const gradeLabel = gradeShort(author.grade);

  return (
    <Card className="p-4 space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center gap-2.5">
        <Link href={`/members/${author.id}`}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link href={`/members/${author.id}`} className="text-headline truncate">
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
          <RecordOwnerMenu
            record={record}
            isMiddleLong={author.blocks?.includes("middle_long") ?? false}
          />
        )}
      </div>

      {/* 距離バー */}
      <IntensityBar record={record} />
      {record.strides > 0 && (
        <p className="text-[12px] text-muted2">流し {record.strides}本</p>
      )}

      {/* テキスト各種 */}
      {record.result_text && <Field label="結果・タイム" value={record.result_text} />}
      {record.strength_text && <Field label="補強" value={record.strength_text} />}
      {record.memo && <Field label="感想" value={record.memo} />}

      <PostActions
        targetType="record"
        targetId={record.id}
        initialLikes={record.likes_count}
        initialLiked={record.liked_by_me ?? false}
        initialComments={record.comments_count ?? 0}
        currentUser={currentUser}
      />
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="section-label mb-0.5">{label}</p>
      <p className="text-[14px] whitespace-pre-wrap break-words">
        <Linkify text={value} />
      </p>
    </div>
  );
}
