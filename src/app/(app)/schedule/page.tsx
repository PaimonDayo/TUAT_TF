import { Header } from "@/components/layout/Header";
import { ScheduleView } from "@/components/features/ScheduleView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUpcomingSchedules, getAttendancesForSchedules } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { ATTENDANCE_TYPES } from "@/lib/constants";
import type { ScheduleWithMenus, Attendee, AttendanceStatusOrNone } from "@/types";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; open?: string }>;
}) {
  const { open } = await searchParams;
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  // 種別の絞り込みはクライアント側で行うため、今後の予定を全件取得する。
  const schedules = (await getUpcomingSchedules(
    profile.blocks,
    perms.createSchedule,
  )) as unknown as ScheduleWithMenus[];

  // 出欠対象の予定 ID をまとめて取得
  const attIds = schedules
    .filter((s) => ATTENDANCE_TYPES.includes(s.schedule_type))
    .map((s) => s.id);
  const attRows = await getAttendancesForSchedules(attIds);

  const attendeesBySchedule: Record<string, Attendee[]> = {};
  const myStatusBySchedule: Record<string, AttendanceStatusOrNone> = {};
  const myLateBySchedule: Record<string, boolean> = {};
  const myLateNoteBySchedule: Record<string, string | null> = {};
  for (const r of attRows) {
    (attendeesBySchedule[r.schedule_id] ??= []).push({
      user_id: r.user_id,
      status: r.status,
      is_late: r.is_late,
      late_note: r.late_note,
      profile: r.profile,
    });
    if (r.user_id === profile.id) {
      myStatusBySchedule[r.schedule_id] = r.status;
      myLateBySchedule[r.schedule_id] = r.is_late;
      myLateNoteBySchedule[r.schedule_id] = r.late_note;
    }
  }

  return (
    <>
      <Header
        title="予定"
        large
      />
      <ScheduleView
        schedules={schedules}
        userId={profile.id}
        viewerBlocks={profile.blocks}
        canEditMenu={perms.createMenu}
        canManageAllMenus={perms.manageMembers}
        canManage={perms.createSchedule}
        attendeesBySchedule={attendeesBySchedule}
        myStatusBySchedule={myStatusBySchedule}
        myLateBySchedule={myLateBySchedule}
        myLateNoteBySchedule={myLateNoteBySchedule}
        showAllAttendanceBlocks={profile.attendance_view_all_blocks ?? false}
        openId={open}
      />
    </>
  );
}
