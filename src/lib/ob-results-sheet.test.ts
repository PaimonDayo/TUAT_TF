import { describe, expect, it } from "vitest";
import { emptyPerformance, type MeetPerformance, type MeetTrial } from "./meet-operations";
import type { ObEntry } from "./ob-entries";
import type { ObEventOperation } from "./ob-operations";
import { obResultSheets, obResultsFileName } from "./ob-results-sheet";

const entry = (id: string, name: string, grade: string, events: string[], extra: Partial<ObEntry> = {}): ObEntry => ({
  id, meet_key: "ob-2026", submitted_name: name, grade, events, profile_id: null, revision: 0, imported_at: "", qualification_marks: {}, ...extra,
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
  entry("f1", "合成跳太", "B2", ["男子走り幅跳び"], { qualification_marks: { "男子走り幅跳び": "6.01" } }),
  entry("f2", "合成跳次", "B3", ["男子走り幅跳び"]),
  entry("h1", "合成高子", "B1", ["女子走り高跳び"]),
  entry("h2", "合成高男", "B2", ["男子走り高跳び"]),
];
const operations = [
  operation("男子100m", [
    placed("e1", 1, 3, { trials: [trial("12.34", "valid", "+1.2")] }),
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

  it("makes one sheet per event in program order", () => {
    expect(sheets.map(sheet => sheet.name)).toEqual(["立ち五段跳び", "100m", "走り高跳び", "走り幅跳び"]);
    for (const value of sheets) expect(value.widths).toHaveLength(value.rows[0].length);
  });

  it("lists every heat in order, keeping DNS, absence, withdrawals and unplaced entrants", () => {
    expect(sheet("100m").rows).toEqual([
      ["組", "レーン", "区分", "氏名", "学年", "出場状況", "記録", "風速", "確認状況", "備考"],
      ["男子1組", 3, "男子", "合成一郎", "B1", "出場", "12.34", "+1.2", "確認済み", ""],
      ["男子1組", 5, "男子", "合成三郎", "B3", "DNS（欠場）", "", "", "確認済み", ""],
      ["男子2組", 1, "男子", "合成五郎", "M1", "出場", "11.90", "0.0", "確認済み", "登録取消・記録保持"],
      ["混合1組", 4, "女子", "合成花子", "B2", "出場", "13.50", "-0.5", "速報", ""],
      ["組未定", null, "男子", "合成四郎", "B4", "欠席", "", "", "確認済み", ""],
      ["組未定", null, "男子", "合成六郎", "OB・OG", "出場", "", "", "確認済み", ""],
    ]);
  });

  it("writes every field attempt with its wind and the best mark's wind", () => {
    expect(sheet("走り幅跳び").rows).toEqual([
      ["試技順", "区分", "氏名", "学年", "出場状況", "記録", "記録の風速", "1回目", "1回目風速", "2回目", "2回目風速", "3回目", "3回目風速", "4回目", "4回目風速", "5回目", "5回目風速", "6回目", "6回目風速", "確認状況", "備考"],
      [1, "男子", "合成跳太", "B2", "出場", "5.60", "+2.5", "5.31", "+1.0", "×", "", "5.60", "+2.5", "−", "", "5.60", "-0.3", "", "", "速報", ""],
      [2, "男子", "合成跳次", "B3", "出場", "記録なし", "", "×", "", "×", "", "×", "", "", "", "", "", "", "", "速報", ""],
    ]);
    expect(sheet("立ち五段跳び").rows).toEqual([
      ["試技順", "区分", "氏名", "学年", "出場状況", "記録", "1回目", "2回目", "3回目", "4回目", "5回目", "6回目", "確認状況", "備考"],
      ["順番未定", "男子", "合成七郎", "B1", "出場", "", "", "", "", "", "", "", "速報", ""],
    ]);
  });

  it("groups high jump attempts under each bar height", () => {
    expect(sheet("走り高跳び").rows).toEqual([
      ["試技順", "区分", "氏名", "学年", "出場状況", "記録", "1.20", "1.25", "1.30", "1.40", "1.50", "確認状況", "備考"],
      [1, "男子", "合成高男", "B2", "出場", "1.4", "", "", "", "○", "×××", "速報", ""],
      [2, "女子", "合成高子", "B1", "出場", "1.25", "○", "×○", "−", "", "", "速報", ""],
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
