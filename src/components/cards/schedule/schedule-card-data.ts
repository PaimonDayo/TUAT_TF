import type { Attendee, AttendanceStatusOrNone, AuthorMini, PracticeMenu } from "@/types";

/** 一覧に自分の出欠がない場合だけ、呼出元の初日の回答を補う。 */
export function seedAttendees(
  attendees: Attendee[],
  mine: {
    userId?: string;
    attendDate: string;
    status: AttendanceStatusOrNone;
    isLate: boolean;
    lateNote: string | null;
    absenceNote: string | null;
    profile?: AuthorMini;
  },
): Attendee[] {
  if (!mine.userId || mine.status === "none" || !mine.profile) return attendees;
  if (
    attendees.some(
      (a) => a.user_id === mine.userId && a.attend_date === mine.attendDate,
    )
  )
    return attendees;
  return [
    ...attendees,
    {
      user_id: mine.userId,
      attend_date: mine.attendDate,
      status: mine.status,
      is_late: mine.isLate,
      late_note: mine.lateNote,
      absence_note: mine.absenceNote,
      profile: mine.profile,
    },
  ];
}

/** 全体メニュー→個別、個別は対象者名→本文の順に並べる。 */
function menuTargetNames(m: PracticeMenu): string {
  return (m.targets?.map((t) => t.profile?.display_name).filter(Boolean) ?? [])
    .sort((a, b) => (a as string).localeCompare(b as string, "ja"))
    .join("、");
}

export function menuCompare(a: PracticeMenu, b: PracticeMenu): number {
  const aNames = menuTargetNames(a);
  const bNames = menuTargetNames(b);
  // 対象者なし（ブロック全体）を先頭に
  const aHasTarget = aNames.length > 0 ? 1 : 0;
  const bHasTarget = bNames.length > 0 ? 1 : 0;
  if (aHasTarget !== bHasTarget) return aHasTarget - bHasTarget;
  if (aNames !== bNames) return aNames.localeCompare(bNames, "ja");
  return (a.content ?? "").localeCompare(b.content ?? "", "ja");
}
