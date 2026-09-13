import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUpcomingSchedulesWithAttendances } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { MiddleLongMenuSnapshot } from "@/lib/middle-long-menu-data";
import type { Attendee, AttendanceDefaultBlock, AttendanceStatusOrNone, AuthorMini, ScheduleWithMenus } from "@/types";

export type SchedulePageData = {
  schedules: ScheduleWithMenus[];
  /**
   * 常に null。予定画面はGoogleスプレッドシートの取得を**待たない**。
   *
   * 以前はここでメニューCSVを取ってから画面を返していたが、`ScheduleCachedView` が
   * マウント直後に `/api/middle-long-menus` で同じものを取り直すので、サーバー側の
   * 取得は表示を遅らせるだけだった（メタ情報→月ごとCSVの2段。lambdaインスタンスごとの
   * 60秒キャッシュなので、外れると毎回Googleまで往復する）。
   * まずDBのメニューで画面を出し、シートの内容は届いた時点で差し替える
   * （CSVが取れないときにDBへ落とす従来の挙動と同じ見え方になる）。
   */
  middleLongMenuSnapshot: MiddleLongMenuSnapshot | null;
  /** この人にシート由来のメニューを出すか。クライアント側の取得の可否もこれで決める。 */
  wantsSheetMenus: boolean;
  userId: string;
  myProfile: AuthorMini;
  viewerBlocks: import("@/types").Block[];
  canEditMenu: boolean;
  canManageAllMenus: boolean;
  canManage: boolean;
  canDecidePractice: boolean;
  attendeesBySchedule: Record<string, Attendee[]>;
  myStatusBySchedule: Record<string, AttendanceStatusOrNone>;
  myLateBySchedule: Record<string, boolean>;
  myLateNoteBySchedule: Record<string, string | null>;
  myAbsenceNoteBySchedule: Record<string, string | null>;
  attendanceDefaultBlock: AttendanceDefaultBlock;
};

export async function getSchedulePageData(): Promise<SchedulePageData> {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  const schedules: (ScheduleWithMenus & { attendances?: (Attendee & { schedule_id: string })[] })[] =
    await getUpcomingSchedulesWithAttendances(profile.blocks, perms.manageSystem || profile.blocks.includes("manager") || profile.schedule_view_all_blocks);
  // シートのメニューはここでは取らない（上の型コメント参照）。誰に出すかだけ決める。
  const wantsSheetMenus =
    profile.blocks.includes("middle_long") ||
    profile.blocks.includes("manager") ||
    profile.menu_view_all_blocks ||
    perms.createMenu;

  const attendeesBySchedule: Record<string, Attendee[]> = {};
  const myStatusBySchedule: Record<string, AttendanceStatusOrNone> = {};
  const myLateBySchedule: Record<string, boolean> = {};
  const myLateNoteBySchedule: Record<string, string | null> = {};
  const myAbsenceNoteBySchedule: Record<string, string | null> = {};
  for (const schedule of schedules) {
    for (const attendee of schedule.attendances ?? []) {
      (attendeesBySchedule[attendee.schedule_id] ??= []).push(attendee);
      // my* は「初日の自分の出欠」。2日目以降はカード側が attendees から日ごとに読む。
      if (attendee.user_id === profile.id && attendee.attend_date === schedule.schedule_date) {
        myStatusBySchedule[attendee.schedule_id] = attendee.status;
        myLateBySchedule[attendee.schedule_id] = attendee.is_late;
        myLateNoteBySchedule[attendee.schedule_id] = attendee.late_note;
        myAbsenceNoteBySchedule[attendee.schedule_id] = attendee.absence_note;
      }
    }
  }

  return {
    schedules,
    userId: profile.id,
    middleLongMenuSnapshot: null,
    wantsSheetMenus,
    myProfile: profile,
    viewerBlocks: profile.blocks,
    canEditMenu: perms.createMenu,
    canManageAllMenus: perms.manageMembers,
    canManage: perms.createSchedule,
    canDecidePractice: perms.decidePractice,
    attendeesBySchedule,
    myStatusBySchedule,
    myLateBySchedule,
    myLateNoteBySchedule,
    myAbsenceNoteBySchedule,
    attendanceDefaultBlock: profile.attendance_default_block,
  };
}
