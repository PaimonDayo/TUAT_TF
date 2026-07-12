"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { SCHEDULE_TYPES } from "@/lib/constants";
import { venueShort } from "@/lib/venues";
import type { AttendanceStatusOrNone, ScheduleWithMenus } from "@/types";

/**
 * ホーム「今後の予定」のコンパクトカード。
 * 出欠タップで出席/欠席の人数もその場で増減させる（AttendanceToggleは
 * 楽観更新＋失敗時に前の状態でonChangedを再度呼ぶため、差分計算だけで
 * ロールバックも自然に成立する）。
 */
export function UpcomingScheduleCard({
  schedule,
  initialStatus,
  initialPresent,
  initialAbsent,
  userId,
}: {
  schedule: ScheduleWithMenus;
  initialStatus: AttendanceStatusOrNone;
  initialPresent: number;
  initialAbsent: number;
  userId: string;
}) {
  const [status, setStatus] = useState<AttendanceStatusOrNone>(initialStatus);
  const [present, setPresent] = useState(initialPresent);
  const [absent, setAbsent] = useState(initialAbsent);
  const meta = SCHEDULE_TYPES[schedule.schedule_type];

  function handleChanged(next: { status: AttendanceStatusOrNone }) {
    setPresent((n) => n + (next.status === "present" ? 1 : 0) - (status === "present" ? 1 : 0));
    setAbsent((n) => n + (next.status === "absent" ? 1 : 0) - (status === "absent" ? 1 : 0));
    setStatus(next.status);
  }

  return (
    <Card className="flex items-center gap-3 p-3">
      <Link
        href={`/schedule?open=${schedule.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 active:opacity-60"
      >
        <div className="flex w-10 shrink-0 flex-col items-center">
          <span className="text-[10px]" style={{ color: meta.color }}>
            {format(new Date(`${schedule.schedule_date}T00:00:00`), "EEE", { locale: ja })}
          </span>
          <span className="text-xl font-bold leading-tight tabular-nums">
            {format(new Date(`${schedule.schedule_date}T00:00:00`), "d")}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Badge style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>{meta.label}</Badge>
            <span className="truncate text-[14px] font-semibold">
              {schedule.title ?? venueShort(schedule.venue_name) ?? meta.label}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-x-3 text-[12px] text-muted2">
            {schedule.meeting_time && (
              <span className="flex shrink-0 items-center gap-1">
                <Clock size={12} /> {schedule.meeting_time.slice(0, 5)}
              </span>
            )}
            <span className="shrink-0 text-success">
              出席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{present}</span>
            </span>
            <span className="shrink-0 text-danger">
              欠席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{absent}</span>
            </span>
          </div>
        </div>
      </Link>
      <AttendanceToggle
        scheduleId={schedule.id}
        userId={userId}
        initial={status}
        onChanged={handleChanged}
      />
    </Card>
  );
}
