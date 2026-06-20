import { format, isPast } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import { NoticeActions } from "@/components/cards/NoticeActions";
import { Linkify } from "@/components/common/Linkify";
import type { NoticeWithReactions } from "@/types";

export function NoticeCard({
  notice,
  canManage = false,
}: {
  notice: NoticeWithReactions;
  /** リアクション機能で使用していたが現在は未使用（呼び出し側の互換のため残置） */
  userId?: string;
  canManage?: boolean;
}) {
  const meta = NOTICE_CATEGORIES[notice.category];
  const deadline = notice.deadline ? new Date(notice.deadline + "T23:59:59") : null;
  const overdue = deadline ? isPast(deadline) : false;

  return (
    <Card id={`notice-${notice.id}`} className="scroll-mt-16 space-y-2 p-4">
      <div className="flex items-center gap-2">
        <Badge style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</Badge>
        <span className="text-micro ml-auto">
          {format(new Date(notice.created_at), "M月d日", { locale: ja })}
        </span>
        {canManage && <NoticeActions notice={notice} />}
      </div>
      <h3 className="text-headline">{notice.title}</h3>
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
    </Card>
  );
}
