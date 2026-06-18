"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented";
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
  canManage = false,
  attendeesBySchedule,
  myStatusBySchedule,
}: {
  schedules: ScheduleWithMenus[];
  userId: string;
  canEditMenu: boolean;
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

      <div className="px-4 pt-1 space-y-3">
        {filtered.length === 0 ? (
          <p className="text-caption text-center py-16">今後の予定はまだ登録されていません。</p>
        ) : (
          filtered.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              canEditMenu={canEditMenu}
              canManage={canManage}
              userId={userId}
              myStatus={myStatusBySchedule[s.id] ?? "none"}
              attendees={attendeesBySchedule[s.id] ?? []}
            />
          ))
        )}
      </div>
    </>
  );
}
