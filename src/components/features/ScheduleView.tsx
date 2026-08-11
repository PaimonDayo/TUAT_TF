"use client";

import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { ScheduleCard } from "@/components/cards/ScheduleCard";
import { SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type { ScheduleWithMenus, Attendee, AttendanceDefaultBlock, AttendanceStatusOrNone, AuthorMini, Block } from "@/types";

/**
 * 練習予定の一覧＋種別タブ。
 * タブ切り替えはサーバー往復せず、読み込み済みの予定をクライアント側で
 * 絞り込むため即時に切り替わる。
 */
export function ScheduleView({
  schedules,
  userId,
  myProfile,
  viewerBlocks,
  canEditMenu,
  canManageAllMenus = false,
  canManage = false,
  canDecidePractice = false,
  attendeesBySchedule,
  myStatusBySchedule,
  myLateBySchedule,
  myLateNoteBySchedule,
  myAbsenceNoteBySchedule,
  attendanceDefaultBlock,
  openId,
}: {
  schedules: ScheduleWithMenus[];
  userId: string;
  myProfile?: AuthorMini;
  viewerBlocks: Block[];
  canEditMenu: boolean;
  canManageAllMenus?: boolean;
  canManage?: boolean;
  canDecidePractice?: boolean;
  attendeesBySchedule: Record<string, Attendee[]>;
  myStatusBySchedule: Record<string, AttendanceStatusOrNone>;
  myLateBySchedule: Record<string, boolean>;
  myLateNoteBySchedule: Record<string, string | null>;
  myAbsenceNoteBySchedule: Record<string, string | null>;
  attendanceDefaultBlock: AttendanceDefaultBlock;
  openId?: string;
}) {
  const [type, setType] = useState("all");
  const [block, setBlock] = useState<"all" | "middle_long" | "short">("all");

  const items = [
    { key: "all", label: "すべて" },
    ...SCHEDULE_TYPE_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
  ];

  const filtered = useMemo(
    () =>
      schedules.filter((s) => {
        const typeMatches = type === "all"
          || (type === "meet" ? s.schedule_type === "meet" || s.schedule_type === "event" : s.schedule_type === type);
        if (!typeMatches) return false;
        if (block === "all") return true;
        return s.target_blocks.length === 0 || s.target_blocks.includes(block);
      }),
    [block, schedules, type],
  );

  return (
    <>
      <div className="px-4 pt-1 pb-3 md:px-6 lg:pb-2">
        <div className="flex min-h-9 items-center lg:min-h-8">
          <SegmentedControl items={items} value={type} onChange={setType} className="w-full md:max-w-[520px]" />
        </div>
        <div className="mt-2">
          <SegmentedControl
            items={[{ key: "all", label: "全体" }, { key: "middle_long", label: "中長距離" }, { key: "short", label: "短距離" }]}
            value={block}
            onChange={(value) => setBlock(value as typeof block)}
            className="w-full md:max-w-[520px]"
          />
        </div>
      </div>

      <div className="px-4 pt-1 md:grid md:grid-cols-2 md:gap-x-3 md:px-6">
        {filtered.length === 0 ? (
          <EmptyState title="まだ今後の予定はありません" />
        ) : (
          filtered.map((s, index) => {
            const monthKey = s.schedule_date.slice(0, 7);
            const previousMonthKey = filtered[index - 1]?.schedule_date.slice(0, 7);
            const startsMonth = monthKey !== previousMonthKey;

            return (
              <Fragment key={s.id}>
                {startsMonth && (
                  <h2 className={index === 0 ? "section-label mb-2 md:col-span-2" : "section-label mb-2 mt-7 md:col-span-2 lg:mt-4"}>
                    {format(new Date(`${s.schedule_date}T00:00:00`), "yyyy年M月")}
                  </h2>
                )}
                <div className="mb-3 min-w-0">
                  <ScheduleCard
                    key={[s.id, (s.menus ?? []).map((menu) => `${menu.id}:${menu.updated_at}`).join(","), myStatusBySchedule[s.id] ?? "none", myLateNoteBySchedule[s.id] ?? "", myAbsenceNoteBySchedule[s.id] ?? "", (attendeesBySchedule[s.id] ?? []).map((a) => [a.user_id, a.status, a.is_late, a.late_note, a.absence_note].join(":")).join(",")].join("|")}
                    schedule={s}
                    viewerBlocks={viewerBlocks}
                    canEditMenu={canEditMenu}
                    canManageAllMenus={canManageAllMenus}
                    canManage={canManage}
                    canDecidePractice={canDecidePractice}
                    userId={userId}
                    myProfile={myProfile}
                    myStatus={myStatusBySchedule[s.id] ?? "none"}
                    myLate={myLateBySchedule[s.id] ?? false}
                    myLateNote={myLateNoteBySchedule[s.id] ?? null}
                    myAbsenceNote={myAbsenceNoteBySchedule[s.id] ?? null}
                    attendees={attendeesBySchedule[s.id] ?? []}
                    attendanceDefaultBlock={attendanceDefaultBlock}
                    defaultOpen={s.id === openId}
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
