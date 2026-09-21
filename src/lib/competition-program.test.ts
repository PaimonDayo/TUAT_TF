import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentProgramRow,
  currentProgramRows,
  nextProgramRows,
  formatAthleteLabel,
  formatAthleteList,
  formatAthletePosition,
  formatProgramEventLabel,
  groupProgramByDate,
  parseCompetitionProgram,
  type ParsedProgramRow,
} from "./competition-program";

const fixture = readFileSync(new URL("./__fixtures__/competition-program-sample.html", import.meta.url), "utf8");

describe("parseCompetitionProgram", () => {
  const rows = parseCompetitionProgram(fixture, 2026);

  it("keeps every program-table row in order, across both dates and blocks", () => {
    expect(rows.map((r) => r.roundKey)).toEqual(["1-0", "1-1", "2-2", "3-0", "4-2", "5-2", "6-2"]);
  });

  it("resolves the date from the H3 heading plus the given year", () => {
    expect(rows[0].eventDate).toBe("2026-09-21");
    expect(rows.find((r) => r.roundKey === "5-2")?.eventDate).toBe("2026-09-22");
  });

  it("only keeps 農工大 entrants from a heat-based individual event", () => {
    const row = rows.find((r) => r.roundKey === "1-0")!;
    expect(row.tuatEntries).toEqual([
      { heat: 1, lane: 2, bib: "202", name: "鈴木 一郎", grade: "B3" },
      { heat: 2, lane: 2, bib: "303", name: "田中 次郎", grade: "B1" },
    ]);
  });

  it("skips a blank filler lane in a heat", () => {
    const row = rows.find((r) => r.roundKey === "1-0")!;
    expect(row.tuatEntries.some((e) => e.bib === null && e.name === "")).toBe(false);
  });

  it("returns no entrants for a round whose start list is not finalized yet", () => {
    const row = rows.find((r) => r.roundKey === "1-1")!;
    expect(row.tuatEntries).toEqual([]);
  });

  it("parses a field event without heat numbers as a flat list", () => {
    const row = rows.find((r) => r.roundKey === "4-2")!;
    expect(row.tuatEntries).toEqual([{ heat: null, lane: 1, bib: "505", name: "高橋 五郎", grade: "B4" }]);
  });

  it("expands a relay team row into one entry per 農工大 runner, fusing name+grade apart", () => {
    const row = rows.find((r) => r.roundKey === "3-0")!;
    expect(row.tuatEntries).toEqual([
      { heat: 1, lane: 2, bib: null, name: "山田 一郎", grade: "B2" },
      { heat: 1, lane: 2, bib: null, name: "山田 二郎", grade: "B3" },
    ]);
  });

  it("keeps a grade that was already given as B-prefixed in the source untouched", () => {
    const row = rows.find((r) => r.roundKey === "3-0")!;
    expect(row.tuatEntries[1].grade).toBe("B3");
  });

  it("does not lose the very first detail block (regression: <H2> boundary must include the tag itself)", () => {
    const row = rows.find((r) => r.roundKey === "1-0")!;
    expect(row.tuatEntries.length).toBeGreaterThan(0);
  });
});

describe("formatProgramEventLabel", () => {
  it("converts full-width digits and letters to half-width", () => {
    expect(formatProgramEventLabel("男子対校 １００ｍ予選(2組2着+2)")).toBe("男子対校 100m予選(2組2着+2)");
  });

  it("shortens オープン to OP", () => {
    expect(formatProgramEventLabel("男子オープン １５００ｍ決勝(2組)")).toBe("男子OP 1500m決勝(2組)");
  });
});

describe("formatAthleteLabel / formatAthleteList", () => {
  it("joins grade and surname with no space", () => {
    expect(formatAthleteLabel({ heat: 1, lane: 2, bib: "202", name: "鈴木 一郎", grade: "B3" })).toBe("B3鈴木");
  });

  it("adds heat and lane for the program detail page", () => {
    expect(formatAthletePosition({ heat: 2, lane: 3, bib: "1", name: "山田 太郎", grade: "B2" })).toBe("2組3番 B2山田");
  });

  it("omits the heat prefix when there is no heat (field events, single-round finals)", () => {
    expect(formatAthletePosition({ heat: null, lane: 5, bib: "1", name: "山田 太郎", grade: "B2" })).toBe("5番 B2山田");
  });

  it("lists multiple athletes separated by 、", () => {
    const list = formatAthleteList([
      { heat: null, lane: 1, bib: "1", name: "山田 太郎", grade: "B2" },
      { heat: null, lane: 2, bib: "2", name: "佐藤 花子", grade: "M1" },
    ]);
    expect(list).toBe("B2山田、M1佐藤");
  });
});

describe("groupProgramByDate", () => {
  const rows = parseCompetitionProgram(fixture, 2026);
  const groups = groupProgramByDate(rows);

  it("groups by date in order, splitting each date into track and field", () => {
    expect(groups.map((g) => g.date)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(groups[0].track.map((r) => r.roundKey)).toEqual(["1-0", "1-1", "2-2", "3-0"]);
    expect(groups[0].field.map((r) => r.roundKey)).toEqual(["4-2"]);
    expect(groups[1].track.map((r) => r.roundKey)).toEqual(["5-2"]);
    expect(groups[1].field.map((r) => r.roundKey)).toEqual(["6-2"]);
  });
});

describe("currentProgramRow", () => {
  const rows = parseCompetitionProgram(fixture, 2026);

  it("does not keep the previous race active after the next race starts without TUAT entrants", () => {
    expect(currentProgramRow(rows, "2026-09-21", "10:31", "track")).toBeNull();
  });

  it("moves on to a later row once its time has passed, if it has entrants", () => {
    const current = currentProgramRow(rows, "2026-09-21", "15:41", "track");
    expect(current?.roundKey).toBe("3-0");
  });

  it("returns null before the first event of the day has started", () => {
    expect(currentProgramRow(rows, "2026-09-21", "09:59", "track")).toBeNull();
  });

  it("returns null on a date with no program rows at all", () => {
    expect(currentProgramRow(rows, "2026-09-23", "12:00", "track")).toBeNull();
  });

  it("tracks track and field independently", () => {
    const field = currentProgramRow(rows, "2026-09-21", "10:00", "field");
    expect(field?.roundKey).toBe("4-2");
  });
});

describe("type sanity", () => {
  it("ParsedProgramRow shape stays assignable", () => {
    const row: ParsedProgramRow = {
      eventDate: "2026-09-21",
      block: "track",
      sortOrder: 1,
      timeLabel: "10:00",
      roundKey: "1-0",
      eventLabel: "男子対校 100m予選",
      status: "未入力",
      tuatEntries: [],
    };
    expect(row.block).toBe("track");
  });
});

describe("currentProgramRows concurrent fields", () => {
  const athlete = { heat: null, lane: 1, bib: "1", name: "テスト", grade: "B1" };
  const field: ParsedProgramRow = { eventDate: "2026-09-22", block: "field", sortOrder: 1, timeLabel: "10:00", roundKey: "f1", eventLabel: "走幅跳", status: "未入力", tuatEntries: [athlete] };
  it("keeps fields with different start times alongside the current track race", () => {
    const rows = [field, { ...field, roundKey: "f2", timeLabel: "10:30" }, { ...field, block: "track" as const, roundKey: "t1", timeLabel: "10:40" }];
    expect(currentProgramRows(rows, "2026-09-22", "10:40").map(row => row.roundKey)).toEqual(["f1", "f2", "t1"]);
  });
  it("excludes completed, cancelled, future, unknown-time and different-day fields", () => {
    const rows = [{ ...field, status: "完了" }, { ...field, status: "中止" }, { ...field, timeLabel: "11:00" }, { ...field, timeLabel: null }, { ...field, eventDate: "2026-09-21" }];
    expect(currentProgramRows(rows, "2026-09-22", "10:30")).toEqual([]);
  });
  it("keeps field attempts active until the official event is complete", () => {
    const finished = { ...athlete, result: { place: "1", record: "6m50" } };
    expect(currentProgramRows([{ ...field, tuatEntries: [finished, athlete] }], "2026-09-22", "10:30")).toHaveLength(1);
    expect(currentProgramRows([{ ...field, tuatEntries: [finished] }], "2026-09-22", "10:30")).toHaveLength(1);
    expect(currentProgramRows([{ ...field, status: "完了", tuatEntries: [finished] }], "2026-09-22", "10:30")).toEqual([]);
  });
});

describe("nextProgramRows", () => {
  const entry = { heat: null, lane: 1, bib: "1", name: "テスト", grade: "B1" };
  const row: ParsedProgramRow = { eventDate: "2026-09-22", block: "track", sortOrder: 1, timeLabel: "10:00", roundKey: "t1", eventLabel: "100m", status: "未入力", tuatEntries: [entry] };
  it("shows the next TUAT track and concurrent fields, skipping races without entrants", () => {
    const rows = [row, { ...row, timeLabel: "11:00", roundKey: "t2" }, { ...row, timeLabel: "10:30", tuatEntries: [] }, { ...row, block: "field" as const, roundKey: "f1", timeLabel: "10:45" }, { ...row, block: "field" as const, roundKey: "f2", timeLabel: "10:45" }];
    expect(nextProgramRows(rows, "2026-09-22", "10:00").map(row => row.roundKey)).toEqual(["f1", "f2", "t2"]);
  });
  it("moves to the next day and returns nothing after the final event", () => {
    expect(nextProgramRows([row], "2026-09-21", "23:59")).toEqual([row]);
    expect(nextProgramRows([row], "2026-09-22", "10:00")).toEqual([]);
  });
  it("ignores unknown times, completed and cancelled events", () => {
    expect(nextProgramRows([{ ...row, timeLabel: null }, { ...row, status: "完了" }, { ...row, status: "中止" }, { ...row, tuatEntries: [{ ...entry, result: { place: null, record: "欠場" } }] }], "2026-09-22", "09:00")).toEqual([]);
  });
});
