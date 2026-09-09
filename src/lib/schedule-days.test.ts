import { describe, expect, it } from "vitest";
import {
  MAX_ATTENDANCE_DAYS,
  currentAttendanceDate,
  scheduleAttendanceDates,
} from "./schedule-days";

describe("scheduleAttendanceDates", () => {
  it("単日の予定はその日だけ", () => {
    expect(scheduleAttendanceDates("2026-09-21", null)).toEqual(["2026-09-21"]);
    expect(scheduleAttendanceDates("2026-09-21", "2026-09-21")).toEqual([
      "2026-09-21",
    ]);
  });

  it("複数日開催は初日から最終日まで並べる", () => {
    expect(scheduleAttendanceDates("2026-09-21", "2026-09-23")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("月をまたいでも暦日で並べる", () => {
    expect(scheduleAttendanceDates("2026-09-30", "2026-10-02")).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("終了日が初日より前など壊れた値は初日だけ", () => {
    expect(scheduleAttendanceDates("2026-09-21", "2026-09-20")).toEqual([
      "2026-09-21",
    ]);
    expect(scheduleAttendanceDates("2026-09-21", "こわれた日付")).toEqual([
      "2026-09-21",
    ]);
  });

  it("極端に長い期間でも上限で打ち切る", () => {
    expect(scheduleAttendanceDates("2026-01-01", "2030-01-01")).toHaveLength(
      MAX_ATTENDANCE_DAYS,
    );
  });
});

describe("currentAttendanceDate", () => {
  const days = ["2026-09-21", "2026-09-22", "2026-09-23"];

  it("開催前は初日", () => {
    expect(currentAttendanceDate(days, "2026-09-01")).toBe("2026-09-21");
  });

  it("開催中はその日以降で最初の日", () => {
    expect(currentAttendanceDate(days, "2026-09-22")).toBe("2026-09-22");
  });

  it("全部終わっていれば最終日", () => {
    expect(currentAttendanceDate(days, "2026-10-01")).toBe("2026-09-23");
  });
});
