import Link from "next/link";
import { Bell, CalendarClock, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Linkify } from "@/components/common/Linkify";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import type { NoticeWithReactions } from "@/types";

function tomorrowInJapan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 86_400_000));
}

export function HomeNotices({ notices }: { notices: NoticeWithReactions[] }) {
  const tomorrow = tomorrowInJapan();

  if (notices.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">お知らせ</p>
        <Link href="/notices" className="flex items-center text-[13px] text-accent">
          すべて見る <ChevronRight size={15} />
        </Link>
      </div>
      <div className="space-y-2">
        {notices.map((notice) => {
          const meta = NOTICE_CATEGORIES[notice.category];
          const reminder = notice.deadline === tomorrow;
          const deadline = notice.deadline
            ? new Date(notice.deadline + "T23:59:59")
            : null;

          if (!notice.pin_home) {
            return (
              <Link key={notice.id} href={`/notices#notice-${notice.id}`} className="block">
                <Card className="flex min-h-12 items-center gap-2.5 p-3 active:bg-bg">
                  <Bell size={16} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-headline">
                    {notice.title}
                  </span>
                  {reminder && (
                    <Badge className="shrink-0 bg-danger/10 text-danger">明日締切</Badge>
                  )}
                  <ChevronRight size={17} className="shrink-0 text-muted" />
                </Card>
              </Link>
            );
          }

          // 重要なお知らせ：✗で消せないよう、閉じるボタンは出さない
          return (
            <Card
              key={notice.id}
              className="space-y-2.5 p-3.5"
              style={{ borderColor: "#ff950055" }}
            >
              <div className="flex items-start gap-2">
                <Bell size={16} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge style={{ backgroundColor: meta.bg, color: meta.color }}>
                      {meta.label}
                    </Badge>
                    {reminder && (
                      <Badge className="bg-danger/10 text-danger">明日締切</Badge>
                    )}
                    <Link
                      href={`/notices#notice-${notice.id}`}
                      className="text-headline active:opacity-60"
                    >
                      {notice.title}
                    </Link>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[13px] text-muted2">
                    <Linkify text={notice.content} />
                  </p>
                  {deadline && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-danger">
                      <CalendarClock size={13} />
                      締切: {format(deadline, "M月d日(E)", { locale: ja })}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
