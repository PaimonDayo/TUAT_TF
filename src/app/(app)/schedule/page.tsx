import { Header } from "@/components/layout/Header";
import { ScheduleView } from "@/components/features/ScheduleView";
import { ScheduleComposer } from "@/components/post/ScheduleForm";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUpcomingSchedules, getAttendancesForSchedules } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { ATTENDANCE_TYPES } from "@/lib/constants";
import type { ScheduleWithMenus, Attendee, AttendanceStatusOrNone } from "@/types";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string }>;
}) {
  const { compose } = await searchParams;
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  // 種別の絞り込みはクライアント側で行うため、今後の予定を全件取得する。
  const schedules = (await getUpcomingSchedules()) as unknown as ScheduleWithMenus[];

  // 出欠対象の予定 ID をまとめて取得
  const attIds = schedules
    .filter((s) => ATTENDANCE_TYPES.includes(s.schedule_type))
    .map((s) => s.id);
  const attRows = await getAttendancesForSchedules(attIds);

  const attendeesBySchedule: Record<string, Attendee[]> = {};
  const myStatusBySchedule: Record<string, AttendanceStatusOrNone> = {};
  for (const r of attRows) {
    (attendeesBySchedule[r.schedule_id] ??= []).push({
      user_id: r.user_id,
      status: r.status,
      profile: r.profile,
    });
    if (r.user_id === profile.id) myStatusBySchedule[r.schedule_id] = r.status;
  }

  return (
    <>
      <Header
        title="練習予定"
        large
        right={perms.createSchedule ? <ScheduleComposer autoOpen={compose === "1"} /> : undefined}
      />
      <ScheduleView
        schedules={schedules}
        userId={profile.id}
        canEditMenu={perms.createMenu}
        attendeesBySchedule={attendeesBySchedule}
        myStatusBySchedule={myStatusBySchedule}
      />
    </>
  );
}
