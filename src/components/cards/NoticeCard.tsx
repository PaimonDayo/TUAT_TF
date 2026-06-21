"use client";

import { format, isPast } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarClock, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import { NoticeActions } from "@/components/cards/NoticeActions";
import { Linkify } from "@/components/common/Linkify";
import { cn } from "@/lib/utils";
import type { NoticeWithReactions } from "@/types";

/**
 * お知らせカード。基本はタイトルのみ表示し、タップで本文を展開する。
 * expanded / onToggle を渡すと展開状態を親で制御できる（通知からの遷移で自動展開するため）。
 */
export function NoticeCard({
  notice,
  canManage = false,
  expanded = false,
  onToggle,
}: {
  notice: NoticeWithReactions;
  /** リアクション機能で使用していたが現在は未使用（呼び出し側の互換のため残置） */
  userId?: string;
  canManage?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const meta = NOTICE_CATEGORIES[notice.category];
  const deadline = notice.deadline ? new Date(notice.deadline + "T23:59:59") : null;
  const overdue = deadline ? isPast(deadline) : false;

  return (
    <Card id={`notice-${notice.id}`} className="scroll-mt-16 p-4">
      {/* ヘッダー＋タイトル＝タップで開閉 */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-start gap-2 active:opacity-60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</Badge>
            <span className="text-micro ml-auto">
              {format(new Date(notice.created_at), "M月d日", { locale: ja })}
            </span>
          </div>
          <h3 className={cn("text-headline mt-1.5", !expanded && "truncate")}>{notice.title}</h3>
        </div>
        {canManage && (
          <div onClick={(e) => e.stopPropagation()}>
            <NoticeActions notice={notice} />
          </div>
        )}
        <ChevronDown
          size={18}
          className={cn(
            "mt-0.5 shrink-0 text-muted transition-transform",
            expanded && "rotate-180",
          )}
        />
      </div>

      {/* 本文（展開時のみ）。リンクのタップで閉じないよう伝播を止める */}
      {expanded && (
        <div className="mt-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
          <p className="text-[14px] whitespace-pre-wrap break-words text-muted2">
            <Linkify text={notice.content} />
          </p>
          {deadline && (
            <p
              className="text-[12px] flex items-center gap-1 font-medium"
              style={{ color: overdue ? "#8e8e93" : "#ff3b30" }}
            >
              <CalendarClock size={13} />
              締切: {format(deadline, "M月d日(E)", { locale: ja })}
              {overdue && "（終了）"}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
