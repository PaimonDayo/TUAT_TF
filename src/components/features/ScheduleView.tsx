"use client";

import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { ScheduleCard } from "@/components/cards/ScheduleCard";
import { SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type { ScheduleWithMenus, Attendee, AttendanceStatusOrNone } from "@/types";

/**
 * 練習予定の一覧＋種別タブ。
 * タブ切り替えはサーバー往復せず、読み込み済みの予定をクライアント側で
 * 絞り込むため即時に切り替わる。
 */
export function ScheduleView({
  schedules,
  userId,
  canEditMenu,
  canManageAllMenus = false,
  canManage = false,
  attendeesBySchedule,
  myStatusBySchedule,
}: {
  schedules: ScheduleWithMenus[];
  userId: string;
  canEditMenu: boolean;
  canManageAllMenus?: boolean;
  canManage?: boolean;
  attendeesBySchedule: Record<string, Attendee[]>;
  myStatusBySchedule: Record<string, AttendanceStatusOrNone>;
}) {
  const [type, setType] = useState("all");

  const items = [
    { key: "all", label: "すべて" },
    ...SCHEDULE_TYPE_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
  ];

  const filtered = useMemo(
    () =>
      schedules.filter((s) => {
        if (type === "all") return true;
        // 「大会・行事」タブは旧データの event も含める
        if (type === "meet") return s.schedule_type === "meet" || s.schedule_type === "event";
        return s.schedule_type === type;
      }),
    [schedules, type],
  );

  return (
    <>
      <div className="px-4 pb-2">
        <SegmentedControl items={items} value={type} onChange={setType} />
      </div>

      <div className="px-4 pt-1">
        {filtered.length === 0 ? (
          <EmptyState title="今後の予定はまだ登録されていません" />
        ) : (
          filtered.map((s, index) => {
            const monthKey = s.schedule_date.slice(0, 7);
            const previousMonthKey = filtered[index - 1]?.schedule_date.slice(0, 7);
            const startsMonth = monthKey !== previousMonthKey;

            return (
              <Fragment key={s.id}>
                {startsMonth && (
                  <h2 className={index === 0 ? "section-label mb-2" : "section-label mb-2 mt-7"}>
                    {format(new Date(`${s.schedule_date}T00:00:00`), "yyyy年M月")}
                  </h2>
                )}
                <div className="mb-3">
                  <ScheduleCard
                    schedule={s}
                    canEditMenu={canEditMenu}
                    canManageAllMenus={canManageAllMenus}
                    canManage={canManage}
                    userId={userId}
                    myStatus={myStatusBySchedule[s.id] ?? "none"}
                    attendees={attendeesBySchedule[s.id] ?? []}
                  />
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </>
  );
}
