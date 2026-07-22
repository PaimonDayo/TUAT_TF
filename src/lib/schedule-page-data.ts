import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUpcomingSchedulesWithAttendances } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { Attendee, AttendanceStatusOrNone, AuthorMini, ScheduleWithMenus } from "@/types";

export type SchedulePageData = {
  schedules: ScheduleWithMenus[];
  userId: string;
  myProfile: AuthorMini;
  viewerBlocks: import("@/types").Block[];
  canEditMenu: boolean;
  canManageAllMenus: boolean;
  canManage: boolean;
  attendeesBySchedule: Record<string, Attendee[]>;
  myStatusBySchedule: Record<string, AttendanceStatusOrNone>;
  myLateBySchedule: Record<string, boolean>;
  myLateNoteBySchedule: Record<string, string | null>;
  showAllAttendanceBlocks: boolean;
};

export async function getSchedulePageData(): Promise<SchedulePageData> {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  const schedules: (ScheduleWithMenus & { attendances?: (Attendee & { schedule_id: string })[] })[] =
    await getUpcomingSchedulesWithAttendances(profile.blocks, perms.createSchedule);

  const attendeesBySchedule: Record<string, Attendee[]> = {};
  const myStatusBySchedule: Record<string, AttendanceStatusOrNone> = {};
  const myLateBySchedule: Record<string, boolean> = {};
  const myLateNoteBySchedule: Record<string, string | null> = {};
  for (const schedule of schedules) {
    for (const attendee of schedule.attendances ?? []) {
      (attendeesBySchedule[attendee.schedule_id] ??= []).push(attendee);
      if (attendee.user_id === profile.id) {
        myStatusBySchedule[attendee.schedule_id] = attendee.status;
        myLateBySchedule[attendee.schedule_id] = attendee.is_late;
        myLateNoteBySchedule[attendee.schedule_id] = attendee.late_note;
      }
    }
  }

  return {
    schedules,
    userId: profile.id,
    myProfile: profile,
    viewerBlocks: profile.blocks,
    canEditMenu: perms.createMenu,
    canManageAllMenus: perms.manageMembers,
    canManage: perms.createSchedule,
    attendeesBySchedule,
    myStatusBySchedule,
    myLateBySchedule,
    myLateNoteBySchedule,
    showAllAttendanceBlocks: profile.attendance_view_all_blocks ?? false,
  };
}
