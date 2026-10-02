import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { AbsenceAttendanceControl, AttendanceToggle, LateAttendanceControl, type AttendanceChange, type LateAttendanceChange } from "@/components/features/AttendanceToggle";
import { AttendeesButton } from "@/components/features/AttendeesButton";
import { jstToday } from "@/lib/date";
import type { Attendee, AttendanceDefaultBlock } from "@/types";

/** 各日の出欠を表示する。回答の状態と更新処理は予定カード側で保持する。 */
export function ScheduleAttendance({
  scheduleId,
  userId,
  attendanceDays,
  multiDayAttendance,
  attendeesState,
  attendanceDefaultBlock,
  handleAttendanceChanged,
  handleAbsenceNoteChanged,
  handleLateChanged
}: {
  scheduleId: string;
  userId: string;
  attendanceDays: string[];
  multiDayAttendance: boolean;
  attendeesState: Attendee[];
  attendanceDefaultBlock: AttendanceDefaultBlock;
  handleAttendanceChanged: (day: string, change: AttendanceChange) => void;
  handleAbsenceNoteChanged: (day: string, note: string | null) => void;
  handleLateChanged: (day: string, change: LateAttendanceChange) => void;
}) {
  return (
    <div className="-mt-1 space-y-2 px-4 pb-3 lg:px-3 lg:pb-2.5">
          {attendanceDays.map((day) => {
            // 複数日開催は日ごとに出欠を出す。単日の予定は従来どおり1行だけ。
            const dayAttendees = multiDayAttendance
              ? attendeesState.filter((a) => a.attend_date === day)
              : attendeesState;
            const mine = attendeesState.find(
              (a) => a.user_id === userId && a.attend_date === day,
            );
            const status = mine?.status ?? "none";
            return (
              <div key={day} className="space-y-2">
                {multiDayAttendance && (
                  <p className="text-caption font-medium">
                    {format(new Date(`${day}T00:00:00`), "M/d (E)", { locale: ja })}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <AttendanceToggle
                    scheduleId={scheduleId}
                    attendDate={day}
                    userId={userId}
                    initial={status}
                    onChanged={(change) => handleAttendanceChanged(day, change)}
                  />
                  <AttendeesButton attendees={dayAttendees} defaultBlock={attendanceDefaultBlock} />
                </div>
                {status === "absent" && (
                  <AbsenceAttendanceControl
                    scheduleId={scheduleId}
                    attendDate={day}
                    userId={userId}
                    initialNote={mine?.absence_note ?? null}
                    onChanged={(note) => handleAbsenceNoteChanged(day, note)}
                  />
                )}
                {day === jstToday() && status === "present" && (
                  <LateAttendanceControl
                    scheduleId={scheduleId}
                    attendDate={day}
                    userId={userId}
                    initialLate={mine?.is_late ?? false}
                    initialNote={mine?.late_note ?? null}
                    onChanged={(change) => handleLateChanged(day, change)}
                  />
                )}
              </div>
            );
          })}
        </div>
  );
}
