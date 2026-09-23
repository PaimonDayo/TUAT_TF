import { describe, expect, it } from "vitest";
import { parseCompetitionProgram, reconcileProgramEntries, validateProgramImport } from "./competition-program";

// 9/23 男子走幅跳: 途中経過は試技済みの選手だけになり、未試技の農工大2人が表から消える。
const page = (status: string, body: string) => `<HTML><H3>09/23</H3><table>
<tr><td colspan=3><B>フィールド</B></td></tr>
<tr><td>10:40</td><td><A Href='#16-2'>男子対校 走幅跳決勝</A></td><td>${status}</td></tr></table>
<H2><A Name='16-2'>男子対校 走幅跳 決勝</A></H2><table>${body}</table></HTML>`;
const starter = (lane: number, name: string) => `<tr><td>${lane}</td><td>${1700 + lane}</td><td>${name}</td><td>2</td><td>農工大･東京</td></tr>`;
const result = `<tr><td>2</td><td>6m12 +1.1</td><td>試験 一郎</td><td>2</td><td>農工大･東京</td></tr>`;
const before = parseCompetitionProgram(page("未入力", starter(29, "試験 一郎") + starter(55, "試験 二郎")), 2026);

describe("partial live program updates", () => {
  it("keeps both starters while neither appears in the interim results, including repeated syncs", () => {
    const incoming = parseCompetitionProgram(page("競技中", ""), 2026);
    const merged = reconcileProgramEntries(incoming, before);
    expect(merged[0].tuatEntries).toEqual(before[0].tuatEntries);
    expect(reconcileProgramEntries(incoming, merged)).toEqual(merged);
  });
  it("merges a new result with the missing starter and keeps their original positions", () => {
    const merged = reconcileProgramEntries(parseCompetitionProgram(page("競技中", result), 2026), before);
    expect(merged[0].tuatEntries).toHaveLength(2);
    expect(merged[0].tuatEntries[0]).toMatchObject({ lane: 29, result: { record: "6m12 +1.1" } });
    expect(merged[0].tuatEntries[1]).toEqual(before[0].tuatEntries[1]);
    expect(reconcileProgramEntries(parseCompetitionProgram(page("完了", result), 2026), merged)[0].tuatEntries).toHaveLength(1);
  });
  it("does not invent a result or carry an outdated placing for an omitted athlete", () => {
    const previous = parseCompetitionProgram(page("競技中", result), 2026);
    expect(reconcileProgramEntries(parseCompetitionProgram(page("競技中", ""), 2026), previous)[0].tuatEntries[0].result).toBeUndefined();
  });
  it("accepts official entry corrections before the start and at completion", () => {
    for (const status of ["未入力", "完了", "中止"]) {
      expect(reconcileProgramEntries(parseCompetitionProgram(page(status, ""), 2026), before)[0].tuatEntries).toEqual([]);
    }
  });
  it("does not borrow entrants from another date, block or round", () => {
    const incoming = parseCompetitionProgram(page("競技中", ""), 2026);
    for (const change of [{ eventDate: "2026-09-22" }, { block: "track" as const }, { roundKey: "17-2" }]) {
      expect(reconcileProgramEntries(incoming, [{ ...before[0], ...change }])[0].tuatEntries).toEqual([]);
    }
  });
  it("does not reinstate relay reserves replaced by the official lineup", () => {
    const eventLabel = "男子対校 ４×１００ｍＲ決勝";
    const incoming = parseCompetitionProgram(page("競技中", ""), 2026).map(row => ({ ...row, eventLabel }));
    expect(reconcileProgramEntries(incoming, before.map(row => ({ ...row, eventLabel })))[0].tuatEntries).toEqual([]);
  });
  it("rejects a missing detail section even with an intact HTML end and unchanged event count", () => {
    const html = page("競技中", "").replace(/<H2>.*?<\/H2>/, "");
    expect(() => validateProgramImport(html, parseCompetitionProgram(html, 2026), 1)).toThrow("種目一覧と詳細");
  });
  it("rejects a single unparsed timetable row", () => {
    const html = page("競技中", "").replace("</table>", `<tr><td>11:00</td><td><a href='#17-2'>別種目</a></td><td></td></tr></table>`);
    expect(() => validateProgramImport(html, parseCompetitionProgram(html, 2026), 1)).toThrow("種目一覧と詳細");
  });
});
