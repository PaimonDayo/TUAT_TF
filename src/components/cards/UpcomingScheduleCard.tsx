"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttendanceToggle, type AttendanceChange } from "@/components/features/AttendanceToggle";
import { attendanceCounts } from "@/components/features/AttendeesButton";
import { SCHEDULE_TYPES } from "@/lib/constants";
import { venueShort } from "@/lib/venues";
import type {
  Attendee,
  AttendanceDefaultBlock,
  AttendanceStatusOrNone,
  AuthorMini,
  ScheduleWithMenus,
} from "@/types";

/**
 * ホーム「今後の予定」のコンパクトカード。
 * 出席・欠席の人数は「出欠一覧の初期表示」で選んだブロックだけを数える
 * （マネージャーは中長距離・短距離のどちらでも数える）。
 * 出欠タップでその場の一覧を更新して人数を数え直すため、AttendanceToggle が
 * 失敗時に前の状態で onChanged を呼び直すとロールバックも自然に成立する。
 */
export function UpcomingScheduleCard({
  schedule,
  initialStatus,
  attendees,
  attendanceDefaultBlock,
  userId,
  myProfile,
}: {
  schedule: ScheduleWithMenus;
  initialStatus: AttendanceStatusOrNone;
  attendees: Attendee[];
  attendanceDefaultBlock: AttendanceDefaultBlock;
  userId: string;
  /** 自分の出欠を即時反映するための最小プロフィール */
  myProfile: AuthorMini;
}) {
  const [status, setStatus] = useState<AttendanceStatusOrNone>(initialStatus);
  const [attendeesState, setAttendeesState] = useState(attendees);
  const meta = SCHEDULE_TYPES[schedule.schedule_type];
  const counted = attendanceCounts(attendeesState, attendanceDefaultBlock);

  function handleChanged(change: AttendanceChange) {
    setStatus(change.status);
    setAttendeesState((previous) => {
      const others = previous.filter((attendee) => attendee.user_id !== userId);
      if (change.status === "none") return others;
      const mine: Attendee = {
        user_id: userId,
        status: change.status,
        is_late: change.isLate,
        late_note: change.lateNote,
        absence_note: change.absenceNote,
        profile: myProfile,
      };
      return [...others, mine];
    });
  }

  return (
    <Card className="flex items-center gap-3 p-3">
      <Link
        href={`/schedule?open=${schedule.id}`}
        prefetch={false}
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
              出席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{counted.present}</span>
            </span>
            <span className="shrink-0 text-danger">
              欠席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{counted.absent}</span>
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
