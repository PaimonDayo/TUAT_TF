"use client";

import { format, isPast } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarClock, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import { NoticeActions } from "@/components/cards/NoticeActions";
import { Linkify } from "@/components/common/Linkify";
import { NoticeReactions } from "@/components/features/NoticeReactions";
import { cn } from "@/lib/utils";
import type { NoticeWithReactions } from "@/types";

/**
 * お知らせカード。基本はタイトルのみ表示し、タップで本文を展開する。
 * expanded / onToggle を渡すと展開状態を親で制御できる（通知からの遷移で自動展開するため）。
 */
export function NoticeCard({
  notice,
  userId,
  canManage = false,
  expanded = false,
  onToggle,
  searchTokens = [],
  searchSnippet,
}: {
  notice: NoticeWithReactions;
  /** リアクション機能で使用していたが現在は未使用（呼び出し側の互換のため残置） */
  userId?: string;
  canManage?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  searchTokens?: string[];
  searchSnippet?: string | null;
}) {
  const meta = NOTICE_CATEGORIES[notice.category];
  const deadline = notice.deadline ? new Date(notice.deadline + "T23:59:59") : null;
  const overdue = deadline ? isPast(deadline) : false;

  return (
    <Card id={`notice-${notice.id}`} className="scroll-mt-16 p-4">
      {/* ヘッダー＋タイトル＝タップで開閉 */}
      <div
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          onToggle?.();
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="flex cursor-pointer items-start gap-2 active:opacity-60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</Badge>
            <span className="text-micro ml-auto">
              {format(new Date(notice.created_at), "M月d日", { locale: ja })}
            </span>
          </div>
          <h3 className={cn("text-headline mt-1.5", !expanded && "truncate")}>
            <HighlightedText text={notice.title} tokens={searchTokens} />
          </h3>
          {!expanded && searchSnippet && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted2">
              本文: <HighlightedText text={searchSnippet} tokens={searchTokens} />
            </p>
          )}
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
          {userId && <NoticeReactions noticeId={notice.id} userId={userId} initialCounts={notice.reaction_counts} initialMine={notice.my_reactions} />}
        </div>
      )}
    </Card>
  );
}

function HighlightedText({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return text;
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return text;

  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const normalizedTokens = new Set(tokens.map((token) => token.toLocaleLowerCase("ja")));

  return text.normalize("NFKC").split(pattern).map((part, index) =>
    normalizedTokens.has(part.toLocaleLowerCase("ja"))
      ? <mark key={`${part}-${index}`} className="rounded-sm bg-[#fff3b0] px-0.5 text-inherit">{part}</mark>
      : part,
  );
}
