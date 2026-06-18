"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X, CalendarClock } from "lucide-react";
import { format, isPast } from "date-fns";
import { ja } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Linkify } from "@/components/common/Linkify";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import type { Notice } from "@/types";

/** ホーム上部の重要お知らせ。各自が×で消せる（確認後に非表示） */
export function HomeNotices({ notices, userId }: { notices: Notice[]; userId: string }) {
  const router = useRouter();
  const [items, setItems] = useState(notices);

  async function dismiss(id: string) {
    setItems((arr) => arr.filter((n) => n.id !== id));
    const supabase = createClient();
    await supabase.from("notice_dismissals").upsert({ user_id: userId, notice_id: id });
    router.refresh();
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <p className="section-label">重要なお知らせ</p>
      <div className="space-y-2">
        {items.map((n) => {
          const meta = NOTICE_CATEGORIES[n.category];
          const deadline = n.deadline ? new Date(n.deadline + "T23:59:59") : null;
          const overdue = deadline ? isPast(deadline) : false;
          return (
            <Card key={n.id} className="p-3.5 border-warning/40" style={{ borderColor: "#ff950055" }}>
              <div className="flex items-start gap-2">
                <Bell size={16} className="text-warning mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Badge style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</Badge>
                    <span className="text-headline">{n.title}</span>
                  </div>
                  <p className="text-[13px] text-muted2 whitespace-pre-wrap break-words">
                    <Linkify text={n.content} />
                  </p>
                  {deadline && (
                    <p
                      className="text-[12px] flex items-center gap-1 font-medium mt-1"
                      style={{ color: overdue ? "#8e8e93" : "#ff3b30" }}
                    >
                      <CalendarClock size={13} />
                      締切: {format(deadline, "M月d日(E)", { locale: ja })}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(n.id)}
                  aria-label="確認済みにする"
                  className="h-7 w-7 -mr-1 -mt-1 flex items-center justify-center text-muted active:opacity-50 shrink-0"
                >
                  <X size={16} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
