import { describe, expect, it } from "vitest";
import { emptyPerformance, type MeetPerformance, type MeetTrial } from "./meet-operations";
import type { ObEntry } from "./ob-entries";
import type { ObEventOperation } from "./ob-operations";
import { obPublishedResultSheets, obResultSheets, obResultsFileName } from "./ob-results-sheet";

const entry = (id: string, name: string, grade: string, events: string[], extra: Partial<ObEntry> = {}): ObEntry => ({
  id, meet_key: "ob-2026", submitted_name: name, grade, events, profile_id: null, revision: 0, imported_at: "", qualification_marks: {}, ...extra,
});

describe("live shared OB workbook", () => {
  it("keeps all 12 tabs and publishes attendance separately from DNS, withdrawals and preserved records", () => {
    const sheets = obPublishedResultSheets(entries, operations);
    expect(sheets.map(sheet => sheet.name)).toEqual(["プログラム", "1500m", "ジャベリックスロー", "立ち五段跳び", "100m", "砲丸投げ", "300mH", "走り高跳び", "300m", "やり投げ", "走り幅跳び", "3000m"]);
    const track = sheets.find(sheet => sheet.name === "100m")!;
    expect(track.rows[0]).toEqual(["組", "レーン", "区分", "氏名", "学年", "大会参加", "出場状況", "記録", "風速"]);
    expect(track.rows.find(row => row.includes("合成三郎"))).toEqual([null, 5, "男子", "合成三郎", "B3", "参加", "DNS（欠場）", "", ""]);
    expect(track.rows.find(row => row.includes("合成四郎"))).toEqual(["組未定", null, "男子", "合成四郎", "B4", "不参加", "欠席", "", ""]);
    expect(track.rows.find(row => row.includes("合成五郎"))).toEqual(["男子2組", 1, "男子", "合成五郎", "M1", "参加", "登録取消（記録あり）", "11.90", "0.0"]);
    expect(track.rows).toContainEqual([]);
    for (const sheet of sheets) expect(sheet.widths).toHaveLength(sheet.rows[0].length);
    expect(sheets.flatMap(sheet => sheet.rows.flat())).not.toContain("11.80");
  });

  it("reflects a new entry, meet absence, event DNS and return to participation without editing source data", () => {
    const roster = [entry("new", "追加合成", "OB・OG", ["男子300m"])];
    const result = (extra: Partial<ObEntry>, status: MeetPerformance["status"] = "entered") => obPublishedResultSheets([{ ...roster[0], ...extra }], [operation("男子300m", [placed("new", 1, 1, { status })])]).find(sheet => sheet.name === "300m")!.rows[1];
    expect(result({}).slice(5, 8)).toEqual(["参加", "出場", ""]);
    expect(result({ absent: true }).slice(5, 8)).toEqual(["不参加", "欠席", ""]);
    expect(result({}, "DNS").slice(5, 8)).toEqual(["参加", "DNS（欠場）", ""]);
    expect(result({}, "DNF").slice(5, 8)).toEqual(["参加", "DNF（途中棄権）", "DNF"]);
    expect(result({}, "DQ").slice(5, 8)).toEqual(["参加", "DQ（失格）", "DQ"]);
    expect(result({ events: [] }).slice(5, 8)).toEqual(["参加", "登録取消", ""]);
    expect(result({ absent: false }).slice(5, 8)).toEqual(["参加", "出場", ""]);
    expect(roster[0].absent).toBeUndefined();
  });
});
const trial = (mark: string, status: MeetTrial["status"] = "valid", wind = ""): MeetTrial => ({ mark, status, wind });
const placed = (id: string, group: number, order: number, extra: Partial<MeetPerformance> = {}): MeetPerformance => ({ ...emptyPerformance(id), group, order, ...extra });
const operation = (event: string, participants: MeetPerformance[], confirmed = false): ObEventOperation => ({ meet_key: "ob-2026", event_name: event, revision: 1, updated_at: "", data: { participants, confirmed } });

const entries = [
  entry("e1", "合成一郎", "B1", ["男子100m"], { qualification_marks: { "男子100m": "11.80" } }),
  entry("e2", "合成花子", "B2", ["女子100m"]),
  entry("e3", "合成三郎", "B3", ["男子100m"]),
  entry("e4", "合成四郎", "B4", ["男子100m"], { absent: true }),
  entry("e5", "合成五郎", "M1", []),
  entry("e6", "合成六郎", "OB・OG", ["男子100m"]),
  entry("e7", "合成七郎", "B1", ["男子立ち五段"]),
  entry("e8", "合成八郎", "B2", ["男子100m"]),
  entry("s1", "合成長一", "B1", ["男子1500m"]),
  entry("s2", "合成長二", "OB・OG", ["男子1500m"]),
  entry("s3", "合成長三", "M2", ["男子1500m"]),
  entry("f1", "合成跳太", "B2", ["男子走り幅跳び"], { qualification_marks: { "男子走り幅跳び": "6.01" } }),
  entry("f2", "合成跳次", "B3", ["男子走り幅跳び"]),
  entry("h1", "合成高子", "B1", ["女子走り高跳び"]),
  entry("h2", "合成高男", "B2", ["男子走り高跳び"]),
];
const operations = [
  operation("男子1500m", [placed("s1", 1, 1), placed("s2", 1, 2), placed("s3", 2, 1)]),
  operation("男子100m", [
    placed("e1", 1, 3, { trials: [trial("12.34", "valid", "+1.2")] }),
    placed("e8", 1, 4),
    placed("e3", 1, 5, { status: "DNS" }),
    placed("e5", 2, 1, { trials: [trial("11.90", "valid", "0.0")] }),
  ], true),
  operation("女子100m", [placed("e2", 1, 4, { heatScope: "混合", trials: [trial("13.50", "valid", "-0.5")] })]),
  operation("男子走り幅跳び", [
    placed("f1", 1, 1, { trials: [trial("5.31", "valid", "+1.0"), trial("", "foul"), trial("5.60", "valid", "+2.5"), trial("", "pass"), trial("5.60", "valid", "-0.3")] }),
    placed("f2", 1, 2, { trials: [trial("", "foul"), trial("", "foul"), trial("", "foul")] }),
  ]),
  operation("女子走り高跳び", [placed("h1", 1, 1, { trials: [trial("1.20"), trial("1.25", "foul"), trial("1.25"), trial("1.30", "pass")] })]),
  operation("男子走り高跳び", [placed("h2", 1, 1, { trials: [trial("1.4"), trial("1.50", "foul"), trial("1.50", "foul"), trial("1.50", "foul")] })]),
];

describe("OB results workbook", () => {
  const sheets = obResultSheets(entries, operations);
  const sheet = (name: string) => sheets.find(sheet => sheet.name === name)!;

  it("starts with the timetable, then one sheet per event in program order", () => {
    expect(sheets.map(sheet => sheet.name)).toEqual(["プログラム", "1500m", "立ち五段跳び", "100m", "走り高跳び", "走り幅跳び"]);
    expect(sheet("プログラム").rows.slice(0, 4)).toEqual([["時刻", "内容", "備考"], ["09:00", "受付開始", ""], ["09:30", "開会式", ""], ["10:00", "1500m", ""]]);
    expect(sheet("プログラム").rows).toContainEqual(["15:30", "4×300mリレー", "当日エントリー"]);
    for (const value of sheets) expect(value.widths).toHaveLength(value.rows[0].length);
  });

  it("writes a pre-meet start list: each heat named once, a blank line between heats, no numbers or status", () => {
    expect(sheet("1500m").rows).toEqual([
      ["組", "区分", "氏名", "学年"],
      ["男子1組", "男子", "合成長一", "B1"],
      [null, "男子", "合成長二", "OB・OG"],
      [],
      ["男子2組", "男子", "合成長三", "M2"],
    ]);
    expect(sheet("立ち五段跳び").rows).toEqual([
      ["試技順", "区分", "氏名", "学年"],
      ["順番未定", "男子", "合成七郎", "B1"],
    ]);
  });

  it("keeps lanes and adds results once recorded, leaving out people who do not compete", () => {
    expect(sheet("100m").rows).toEqual([
      ["組", "レーン", "区分", "氏名", "学年", "記録", "風速"],
      ["男子1組", 3, "男子", "合成一郎", "B1", "12.34", "+1.2"],
      [null, 4, "男子", "合成八郎", "B2", "", ""],
      [],
      ["男子2組", 1, "男子", "合成五郎", "M1", "11.90", "0.0"],
      [],
      ["混合1組", 4, "女子", "合成花子", "B2", "13.50", "-0.5"],
      [],
      ["組未定", null, "男子", "合成六郎", "OB・OG", "", ""],
    ]);
    const cells = sheets.flatMap(sheet => sheet.rows.flat());
    expect(cells).not.toContain("合成三郎"); // DNS
    expect(cells).not.toContain("合成四郎"); // absent
    for (const header of ["番号", "出場状況", "確認状況", "備考"]) expect(sheets.slice(1).flatMap(sheet => sheet.rows[0])).not.toContain(header);
  });

  it("writes every field attempt with its wind and the best mark's wind", () => {
    expect(sheet("走り幅跳び").rows).toEqual([
      ["試技順", "区分", "氏名", "学年", "記録", "記録の風速", "1回目", "1回目風速", "2回目", "2回目風速", "3回目", "3回目風速", "4回目", "4回目風速", "5回目", "5回目風速", "6回目", "6回目風速"],
      [1, "男子", "合成跳太", "B2", "5.60", "+2.5", "5.31", "+1.0", "×", "", "5.60", "+2.5", "−", "", "5.60", "-0.3", "", ""],
      [2, "男子", "合成跳次", "B3", "記録なし", "", "×", "", "×", "", "×", "", "", "", "", "", "", ""],
    ]);
  });

  it("groups high jump attempts under each bar height", () => {
    expect(sheet("走り高跳び").rows).toEqual([
      ["試技順", "区分", "氏名", "学年", "記録", "1.20", "1.25", "1.30", "1.40", "1.50"],
      [1, "男子", "合成高男", "B2", "1.4", "", "", "", "○", "×××"],
      [2, "女子", "合成高子", "B1", "1.25", "○", "×○", "−", "", ""],
    ]);
  });

  it("does not export qualification marks", () => {
    const cells = sheets.flatMap(sheet => sheet.rows.flat());
    expect(cells).not.toContain("11.80");
    expect(cells).not.toContain("6.01");
    expect(cells.some(cell => typeof cell === "string" && cell.includes("資格"))).toBe(false);
  });

  it("does not change the screen's operations", () => {
    const before = JSON.stringify(operations);
    obResultSheets(entries, operations);
    expect(JSON.stringify(operations)).toBe(before);
  });

  it("names the file with the JST time", () => {
    expect(obResultsFileName(new Date("2026-10-07T06:05:00Z"))).toBe("OB戦_組・記録_20261007-1505.xlsx");
    expect(obResultsFileName(new Date("2026-10-07T15:00:00Z"))).toBe("OB戦_組・記録_20261008-0000.xlsx");
  });
});
