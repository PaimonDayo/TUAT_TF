"use client";

import Link from "next/link";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/key-value";
import { IntensityBar } from "@/components/features/IntensityBar";
import { formatKm } from "@/lib/utils";
import { PostActions } from "@/components/cards/PostActions";
import { RecordOwnerMenu } from "@/components/cards/PostOwnerMenu";
import { CONDITIONS, gradeShort } from "@/lib/constants";
import { recordFieldHidden, recordFieldLabel } from "@/lib/record-fields";
import { displayedDistance } from "@/lib/record-distance";
import type { CommentAuthor, RecordFieldDef, RecordWithAuthor } from "@/types";

const NON_DETAIL_KEYS = new Set(["dist_low", "dist_mid", "dist_high", "dist_speed", "dist_actual", "strides", "condition"]);

function recordValue(record: RecordWithAuthor, key: string): string | number | null | undefined {
  if (key === "menu_text") return record.menu_text;
  if (key === "focus_text") return record.focus_text;
  if (key === "result_text") return record.result_text;
  if (key === "strength_text") return record.strength_text;
  if (key === "memo") return record.memo;
  return record.custom?.[key];
}

/** タイムライン用の練習記録カード。compact=簡易表示（テキスト詳細を畳む） */
export function RecordCard({
  record,
  currentUser,
  compact = false,
  commentsExpanded = false,
  showSource = false,
  embedded = false,
}: {
  record: RecordWithAuthor;
  currentUser: CommentAuthor;
  compact?: boolean;
  commentsExpanded?: boolean;
  showSource?: boolean;
  embedded?: boolean;
}) {
  const { author } = record;
  const recordFields = record.record_fields_version !== null && record.record_fields_version !== undefined
    ? (record.record_fields_snapshot ?? [])
    : (author.record_fields ?? []);
  const hasTimelineConfig = recordFields.some((field) => typeof field.showInTimeline === "boolean");
  const cond = record.condition ? CONDITIONS[record.condition] : null;
  const isOwner = currentUser.id === author.id;
  const gradeLabel = gradeShort(author.grade);
  const totalDistance = displayedDistance(record);
  const fieldVisible = (key: Parameters<typeof recordFieldHidden>[1]) => hasTimelineConfig
    ? recordFields.some((field) => field.key === key && field.showInTimeline === true && !field.hidden)
    : !recordFieldHidden(recordFields, key);
  const distanceVisible = hasTimelineConfig
    ? recordFields.some((field) => field.key.startsWith("dist_") && field.showInTimeline === true && !field.hidden)
    : true;
  const configuredDetails = hasTimelineConfig
    ? recordFields.filter((field) => field.showInTimeline === true && !field.hidden && !NON_DETAIL_KEYS.has(field.key))
    : [];
  const legacyDetails: RecordFieldDef[] = hasTimelineConfig ? [] : [
    { key: "menu_text", label: recordFieldLabel(recordFields, "menu_text", "メニュー"), type: "text", hidden: !fieldVisible("menu_text") },
    { key: "focus_text", label: recordFieldLabel(recordFields, "focus_text", "目的・意識すること"), type: "text", hidden: !fieldVisible("focus_text") },
    { key: "result_text", label: recordFieldLabel(recordFields, "result_text", record.menu_text || record.focus_text ? "タイム" : "結果"), type: "text", hidden: !fieldVisible("result_text") },
    { key: "strength_text", label: recordFieldLabel(recordFields, "strength_text", "補強"), type: "text", hidden: !fieldVisible("strength_text") },
    { key: "memo", label: recordFieldLabel(recordFields, "memo", "感想"), type: "text", hidden: !fieldVisible("memo") },
  ];
  const details = [...configuredDetails, ...legacyDetails].filter((field) => !field.hidden && recordValue(record, field.key) !== null && recordValue(record, field.key) !== undefined && recordValue(record, field.key) !== "");

  return (
    <Card className={embedded ? "space-y-3 rounded-none border-0 p-4" : "space-y-3 p-4"}>
      <div className="flex items-center gap-2.5">
        <Link href={`/members/${author.id}`} onClick={(event) => event.stopPropagation()}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/members/${author.id}`} onClick={(event) => event.stopPropagation()} className="text-headline truncate">{author.display_name || "名無し"}</Link>
            <BlockPills blocks={author.blocks} />
            {gradeLabel && <span className="text-micro">{gradeLabel}</span>}
          </div>
          <p className="text-caption">{format(new Date(record.recorded_date + "T00:00:00"), "M月d日(E)", { locale: ja })}の練習</p>
        </div>
        {cond && fieldVisible("condition") && <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold" style={{ color: cond.color }} title={cond.label}><span className="text-[16px] leading-none">{cond.symbol}</span>{cond.label}</span>}
        <div className="flex shrink-0 items-center gap-1.5">
          {(isOwner || showSource) && record.from_sheet && <span className="rounded-full bg-bg px-2 py-0.5 text-micro text-muted2">スプレッドシート</span>}
          {showSource && !record.from_sheet && <span className="rounded-full bg-bg px-2 py-0.5 text-micro text-muted2">アプリ由来</span>}
          <span onClick={(event) => event.stopPropagation()}><RecordOwnerMenu record={record} isOwner={isOwner} isMiddleLong={author.blocks?.includes("middle_long") ?? false} recordSource={author.record_source} recordFields={recordFields} systemRecordForm={currentUser.systemRecordForm === true && hasTimelineConfig} /></span>
        </div>
      </div>

      {compact
        ? distanceVisible && totalDistance > 0 && <p className="text-[13px] font-semibold tabular-nums text-muted2">走行距離 {formatKm(totalDistance)}km</p>
        : distanceVisible && totalDistance > 0 && <IntensityBar record={record} />}
      {!compact && fieldVisible("strides") && record.strides > 0 && <p className="text-[12px] text-muted2">{recordFieldLabel(recordFields, "strides", "流し")} {record.strides}本</p>}

      {!compact && details.length > 0 && <dl>{details.map((field) => <KeyValue key={field.key} label={field.label} value={recordValue(record, field.key)} />)}</dl>}

      <div onClick={(event) => event.stopPropagation()}>
        <PostActions targetType="record" targetId={record.id} initialLikes={record.likes_count} initialLiked={record.liked_by_me ?? false} initialComments={record.comments_count ?? 0} currentUser={currentUser} commentsExpanded={commentsExpanded} />
      </div>
    </Card>
  );
}
