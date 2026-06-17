import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { ScheduleTabs } from "@/components/features/ScheduleTabs";
import { ScheduleCard } from "@/components/cards/ScheduleCard";
import { ScheduleComposer } from "@/components/post/ScheduleForm";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUpcomingSchedules, getAttendancesForSchedules } from "@/lib/queries";
import { ATTENDANCE_TYPES } from "@/lib/constants";
import type { ScheduleWithMenus, Attendee, AttendanceStatusOrNone } from "@/types";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; compose?: string }>;
}) {
  const { type, compose } = await searchParams;
  const profile = await getCurrentProfile();
  const isStaff = profile.role === "admin" || profile.role === "menu_staff";
  const schedules = (await getUpcomingSchedules(type)) as unknown as ScheduleWithMenus[];

  // 出欠対象の予定 ID をまとめて取得
  const attIds = schedules
    .filter((s) => ATTENDANCE_TYPES.includes(s.schedule_type))
    .map((s) => s.id);
  const attRows = await getAttendancesForSchedules(attIds);

  const bySchedule = new Map<string, Attendee[]>();
  const myStatus = new Map<string, AttendanceStatusOrNone>();
  for (const r of attRows) {
    if (!bySchedule.has(r.schedule_id)) bySchedule.set(r.schedule_id, []);
    bySchedule.get(r.schedule_id)!.push({ user_id: r.user_id, status: r.status, profile: r.profile });
    if (r.user_id === profile.id) myStatus.set(r.schedule_id, r.status);
  }

  return (
    <>
      <Header
        title="練習予定"
        large
        right={isStaff ? <ScheduleComposer autoOpen={compose === "1"} /> : undefined}
      />
      <Suspense>
        <ScheduleTabs />
      </Suspense>

      <div className="px-4 pt-1 space-y-3">
        {schedules.length === 0 ? (
          <p className="text-caption text-center py-16">今後の予定はまだ登録されていません。</p>
        ) : (
          schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              canEditMenu={isStaff}
              userId={profile.id}
              myStatus={myStatus.get(s.id) ?? "none"}
              attendees={bySchedule.get(s.id) ?? []}
            />
          ))
        )}
      </div>
    </>
  );
}
