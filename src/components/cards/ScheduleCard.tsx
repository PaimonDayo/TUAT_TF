"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import {
  Clock,
  MapPin,
  ChevronDown,
  Train,
  Coins,
  CalendarRange,
  ExternalLink,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SCHEDULE_TYPES, ATTENDANCE_TYPES } from "@/lib/constants";
import { venueShort } from "@/lib/venues";
import { cn } from "@/lib/utils";
import { MenuForm } from "@/components/post/MenuForm";
import { ScheduleManageActions } from "@/components/post/ScheduleForm";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { AttendeesButton } from "@/components/features/AttendeesButton";
import { Linkify } from "@/components/common/Linkify";
import type { ScheduleWithMenus, Attendee, AttendanceStatusOrNone } from "@/types";

/** 展開式の練習予定カード */
export function ScheduleCard({
  schedule,
  canEditMenu = false,
  canManage = false,
  userId,
  myStatus = "none",
  attendees = [],
}: {
  schedule: ScheduleWithMenus;
  canEditMenu?: boolean;
  canManage?: boolean;
  userId?: string;
  myStatus?: AttendanceStatusOrNone;
  attendees?: Attendee[];
}) {
  const [open, setOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const meta = SCHEDULE_TYPES[schedule.schedule_type];
  const date = new Date(schedule.schedule_date + "T00:00:00");
  const hasMenus = schedule.menus && schedule.menus.length > 0;
  const showAttendance = userId && ATTENDANCE_TYPES.includes(schedule.schedule_type);
  const hasEntry = schedule.entry_start || schedule.entry_end;
  const hasDetail =
    schedule.venue_access ||
    schedule.venue_fee ||
    schedule.venue_url ||
    schedule.note ||
    hasEntry ||
    hasMenus ||
    canEditMenu ||
    canManage;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="w-full p-4 flex items-center gap-3 text-left active:bg-bg"
      >
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="text-[11px]" style={{ color: meta.color }}>
            {format(date, "EEE", { locale: ja })}
          </span>
          <span className="text-2xl font-bold leading-tight tabular-nums">{format(date, "d")}</span>
          <span className="text-micro">{format(date, "M月", { locale: ja })}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge style={{ backgroundColor: meta.color + "1a", color: meta.color }}>{meta.label}</Badge>
            <span className="text-headline truncate">
              {schedule.title ?? venueShort(schedule.venue_name ?? schedule.location) ?? meta.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted2">
            {schedule.end_date && schedule.end_date !== schedule.schedule_date && (
              <span className="flex items-center gap-1">
                <CalendarRange size={13} />
                {format(date, "M/d", { locale: ja })} 〜{" "}
                {format(new Date(schedule.end_date + "T00:00:00"), "M/d", { locale: ja })}
              </span>
            )}
            {schedule.meeting_time && (
              <span className="flex items-center gap-1">
                <Clock size={13} /> {schedule.meeting_time.slice(0, 5)}
              </span>
            )}
            {/* タイトルがある予定（大会等）は場所も補足表示。練習はタイトル位置が場所なので省略 */}
            {schedule.title && (schedule.venue_name || schedule.location) && (
              <span className="flex items-center gap-1">
                <MapPin size={13} /> {venueShort(schedule.venue_name ?? schedule.location)}
              </span>
            )}
          </div>
        </div>

        {hasDetail && (
          <ChevronDown
            size={18}
            className={cn("text-muted transition-transform shrink-0", open && "rotate-180")}
          />
        )}
      </button>

      {/* 出欠行 */}
      {showAttendance && (
        <div className="px-4 pb-3 -mt-1 flex items-center gap-2">
          <AttendanceToggle
            scheduleId={schedule.id}
            userId={userId!}
            initial={myStatus}
            refreshOnChange
          />
          <AttendeesButton attendees={attendees} />
        </div>
      )}

      {open && hasDetail && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-separator">
          {hasEntry && (
            <Detail
              icon={<CalendarRange size={14} />}
              label="エントリー期間"
              value={`${fmt(schedule.entry_start)} 〜 ${fmt(schedule.entry_end)}`}
            />
          )}
          {schedule.venue_access && (
            <div>
              <button
                onClick={() => setAccessOpen((v) => !v)}
                className="section-label flex items-center gap-1 active:opacity-50"
              >
                <Train size={14} /> アクセス
                <ChevronDown
                  size={14}
                  className={cn("transition-transform", accessOpen && "rotate-180")}
                />
              </button>
              {accessOpen && (
                <p className="text-[14px] whitespace-pre-wrap mt-0.5">{schedule.venue_access}</p>
              )}
            </div>
          )}
          {schedule.venue_fee && (
            <Detail icon={<Coins size={14} />} label="参加費" value={schedule.venue_fee} />
          )}
          {schedule.note && (
            <Detail icon={<Info size={14} />} label="詳細情報" value={schedule.note} />
          )}
          {schedule.venue_url && (
            <a
              href={schedule.venue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent font-medium active:opacity-50"
            >
              <MapPin size={14} /> 地図を開く <ExternalLink size={12} className="opacity-50" />
            </a>
          )}

          {(hasMenus || canEditMenu) && (
            <div>
              <p className="section-label mb-1.5">練習メニュー</p>
              <div className="space-y-2">
                {schedule.menus?.map((m) => (
                  <div key={m.id} className="rounded-xl bg-bg p-3">
                    {m.author?.display_name && (
                      <p className="text-[12px] font-semibold text-accent mb-1">
                        担当: {m.author.display_name}
                      </p>
                    )}
                    <p className="text-[14px] whitespace-pre-wrap">
                      <Linkify text={m.content} />
                    </p>
                  </div>
                ))}
              </div>
              {canEditMenu && <MenuForm scheduleId={schedule.id} />}
            </div>
          )}

          {canManage && <ScheduleManageActions schedule={schedule} />}
        </div>
      )}
    </Card>
  );
}

function fmt(d: string | null): string {
  if (!d) return "";
  return format(new Date(d + "T00:00:00"), "M/d", { locale: ja });
}

function Detail({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="section-label mb-0.5 flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-[14px] whitespace-pre-wrap">
        <Linkify text={value} />
      </p>
    </div>
  );
}
