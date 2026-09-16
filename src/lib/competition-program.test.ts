import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentProgramRow,
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

  it("picks the latest track row at or before now that has 農工大 entrants", () => {
    // 10:00の予選(entrants有)と10:30の準決勝(entrants無)のうち、10:30時点では
    // 予選が「いま行われている」ことになる(準決勝はエントリー未確定なので対象外)。
    const current = currentProgramRow(rows, "2026-09-21", "10:31", "track");
    expect(current?.roundKey).toBe("1-0");
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
