import { describe, expect, it } from 'vitest';
import { parseCompetitionProgram, retainProgramPositions, validateProgramImport, formatAthletePosition } from './competition-program';
const header = `<HTML><H3>09/22</H3><table><tr><td colspan=3><B>トラック</B></td></tr><tr><td>09:00</td><td><A Href='#1-2'>男子 １００ｍ決勝</A></td><td>完了</td></tr></table><H2><A Name='1-2'>男子</A></H2>`;
describe('official live result format', () => {
 it('reads rank/record instead of mistaking them for lane/bib; preserves DNS', () => {
   const rows=parseCompetitionProgram(header+`【1組】<font color='red'><b>結果</b></font>風:+1.2<table><tr><td>2</td><td>10.83</td><td>試験 太郎</td><td>2</td><td>農工大･東京</td></tr><tr><td>&nbsp;</td><td>欠場</td><td>試験 次郎</td><td>1</td><td>農工大･東京</td></tr></table></HTML>`,2026);
   expect(rows[0].tuatEntries[0]).toEqual({heat:1,lane:null,bib:null,name:'試験 太郎',grade:'B2',result:{place:'2',record:'10.83',wind:'+1.2'}});
   expect(rows[0].tuatEntries[1].result).toMatchObject({place:null,record:'欠場'});
   expect(formatAthletePosition(rows[0].tuatEntries[0])).toBe('1組 B2試験');
 });
 it('parses relays from result rank, record, team and four runner columns', () => {
   const html=header.replace('１００ｍ','４×１００ｍ')+`<b>結果</b><table><tr><td>3</td><td>42.10</td><td>農工大･東京</td><td>試験 一郎1</td><td>試験 二郎2</td><td>試験 三郎3</td><td>試験 四郎4</td></tr></table></HTML>`;
   const entries=parseCompetitionProgram(html,2026)[0].tuatEntries;
   expect(entries).toHaveLength(4);expect(entries[0].result).toEqual({place:'3',record:'42.10'});
 });
 it('keeps uncompleted heats as start lists when another heat has results', () => {
   const html=header+`【1組】<b>結果</b><table><tr><td>1</td><td>11.10</td><td>試験 太郎</td><td>2</td><td>農工大･東京</td></tr></table>【2組】<b>スタートリスト</b><table><tr><td>5</td><td>1701</td><td>試験 次郎</td><td>1</td><td>農工大･東京</td></tr></table></HTML>`;
   const entries=parseCompetitionProgram(html,2026)[0].tuatEntries;
   expect(entries[0].result?.record).toBe('11.10');expect(entries[1]).toMatchObject({heat:2,lane:5,bib:'1701'});expect(entries[1].result).toBeUndefined();
 });
 it('retains old lane and bib only for an unambiguous athlete match', () => {
   const rows=parseCompetitionProgram(header+`<b>結果</b><table><tr><td>1</td><td>10.83</td><td>試験 太郎</td><td>2</td><td>農工大･東京</td></tr></table></HTML>`,2026);
   const old=structuredClone(rows);old[0].tuatEntries[0]={...old[0].tuatEntries[0],lane:5,bib:'1700'};
   expect(retainProgramPositions(rows,old)[0].tuatEntries[0]).toMatchObject({lane:5,bib:'1700'});
   old[0].tuatEntries.push({...old[0].tuatEntries[0]});expect(retainProgramPositions(rows,old)[0].tuatEntries[0].lane).toBeNull();
 });
 it('rejects empty, truncated and unexpectedly shortened downloads', () => {
   expect(()=>validateProgramImport('<HTML>',[],20)).toThrow();
   const rows=parseCompetitionProgram(header+'</HTML>',2026);
   expect(()=>validateProgramImport(header+'</HTML>',rows,20)).toThrow();
   expect(()=>validateProgramImport(header+'</HTML>',rows,1)).not.toThrow();
 });
});

// 実在する終了済み大会（sairiku.net の静的ページ）と同じ構造。2026-09-22 に実データで確認した。
describe("finished-meet result pages", () => {
  const timedFinal = (team: string) => `<HTML><H3>08/01</H3>
<table><tr><td colspan=3><B>トラック</B></td></tr>
<tr><td>10:00</td><td><A Href='#8-0'>女子 １００ｍ予選(13組タイムレース)</A></td><td>完了</td></tr></table>
<H2><A Name='8-0'>女子 １００ｍ予選(13組タイムレース)</A></H2>
【4組】<font color='red'><b>結果</b></font>(-0.9ｍ)<br>
<table border=1>
<tr><td>1</td><td>12.72</td><td>髙橋 祐生弥</td><td>1</td><td>${team}･埼玉</td></tr>
<tr><td>&nbsp;</td><td>欠場</td><td>佐伯 海愛</td><td>2</td><td>滑川総合高･埼玉</td></tr>
</table>
<H2>総合</H2>
<table border=1>
<tr><td>1</td><td>12.72(+0.2)</td><td>髙橋 祐生弥</td><td>1</td><td>${team}･埼玉</td></tr>
<tr><td>2</td><td>12.76(+0.7)</td><td>岡田 裕佳</td><td>4</td><td>${team}･埼玉</td></tr>
</table></html>`;

  it("does not repeat an athlete who also appears in the 総合 summary table", () => {
    const row = parseCompetitionProgram(timedFinal("農工大"), 2026)[0];
    expect(row.tuatEntries).toHaveLength(1);
    expect(row.tuatEntries[0].heat).toBe(4);
  });

  it("takes the overall place and its wind from the 総合 table", () => {
    const entry = parseCompetitionProgram(timedFinal("農工大"), 2026)[0].tuatEntries[0];
    expect(entry.result).toEqual({ place: "1", record: "12.72", wind: "+0.2", overallPlace: "1" });
  });

  it("falls back to the wind printed next to 結果 when there is no 総合 table", () => {
    const html = timedFinal("農工大").replace(/<H2>総合<\/H2>[\s\S]*<\/table>/, "");
    expect(parseCompetitionProgram(html, 2026)[0].tuatEntries[0].result)
      .toEqual({ place: "1", record: "12.72", wind: "-0.9" });
  });

  it("ignores the whole event when no TUAT athlete is in it", () => {
    expect(parseCompetitionProgram(timedFinal("大東大"), 2026)[0].tuatEntries).toHaveLength(0);
  });

  it("reads a relay result as one team record shared by its runners, DQ reason included", () => {
    const html = `<HTML><H3>08/01</H3>
<table><tr><td colspan=3><B>トラック</B></td></tr>
<tr><td>15:00</td><td><A Href='#3-2'>男子 ４×１００ｍＲ決勝(2組)</A></td><td>完了</td></tr></table>
<H2><A Name='3-2'>男子 ４×１００ｍＲ決勝(2組)</A></H2>
【1組】<font color='red'><b>結果</b></font><br>
<table border=1>
<tr><td>&nbsp;</td><td>失格<br>TR24.6</td><td>農工大 </td><td>二宮 仙諮1</td><td>林 翔大2</td><td>忽滑谷 悠人2</td><td>東久保 和真2</td></tr>
</table></html>`;
    const entries = parseCompetitionProgram(html, 2026)[0].tuatEntries;
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.grade + e.name.split(" ")[0])).toEqual(["B1二宮", "B2林", "B2忽滑谷", "B2東久保"]);
    expect(new Set(entries.map((e) => e.result?.record))).toEqual(new Set(["失格 TR24.6"]));
  });
});

// 2026-09-22 の27大戦・本番ページで実際に取りこぼしていた2つの形。
describe("rows the official page writes differently", () => {
  const event = (label: string, body: string) => `<HTML><H3>09/22</H3>
<table><tr><td colspan=3><B>フィールド</B></td></tr>
<tr><td>09:30</td><td><A Href='#17-2'>${label}</A></td><td></td></tr></table>
<H2><A Name='17-2'>${label}</A></H2>
${body}</html>`;

  it("reads a field result table that has no 結果 heading (三段跳 was dropped entirely)", () => {
    const html = event("男子対校 三段跳決勝", `<table border=1>
<tr><td>3</td><td>14m15 +1.2</td><td>和田 佳大</td><td>3</td><td>農工大･福島</td><td>13m94<br>+4.3</td><td>14m15<br>+1.2</td><td><br></td></tr>
</table>`);
    const entries = parseCompetitionProgram(html, 2026)[0].tuatEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toEqual({ place: "3", record: "14m15 +1.2" });
  });

  it("keeps a scratched athlete whose row carries attributes (<tr bgcolor='gray'>)", () => {
    const html = event("女子対校 ２００ｍ決勝(5組)", `【1組】<font color='blue'><b>スタートリスト</b></font><br>
<table border=1>
<tr bgcolor='gray'><td>欠</td><td>1725</td><td>熊谷 千尋</td><td>M1</td><td>農工大･長野</td></tr>
<tr><td>3</td><td>1730</td><td>石崎 花</td><td>2</td><td>農工大･東京</td></tr>
</table>`);
    const entries = parseCompetitionProgram(html, 2026)[0].tuatEntries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ heat: 1, name: "熊谷 千尋", grade: "M1", result: { record: "欠場" } });
    expect(entries[1]).toMatchObject({ heat: 1, lane: 3, bib: "1730", name: "石崎 花" });
    expect(entries[1].result).toBeUndefined();
  });

  it("still tells a start-list number apart from a record in the same column", () => {
    const html = event("男子対校 走幅跳決勝", `<table border=1>
<tr><td>5</td><td>39</td><td>和田 佳大</td><td>3</td><td>農工大･福島</td></tr>
</table>`);
    const entry = parseCompetitionProgram(html, 2026)[0].tuatEntries[0];
    expect(entry).toMatchObject({ lane: 5, bib: "39" });
    expect(entry.result).toBeUndefined();
  });
});

// 4×100mRは走者4人のうしろに空欄が4つ付き、4×400mRは6人ぶんの欄が並ぶ。
// 列数を決め打ちにしていたため、4×100mRだけ丸ごと0人になっていた。
describe("relay rows whose column count varies", () => {
  const relay = (body: string) => `<HTML><H3>09/22</H3>
<table><tr><td colspan=3><B>トラック</B></td></tr>
<tr><td>16:20</td><td><A Href='#12-2'>男子対校 ４×１００ｍＲ決勝(4組)</A></td><td></td></tr></table>
<H2><A Name='12-2'>男子対校 ４×１００ｍＲ決勝(4組)</A></H2>
${body}</html>`;

  it("reads a start list padded with empty columns", () => {
    const html = relay(`【3組】<font color='blue'><b>スタートリスト</b></font><br>
<table border=1>
<tr><td>2</td><td>農工大</td><td>林 夏輝2</td><td>岸田 健斗3</td><td>最上 瑛介2</td><td>後藤 練B2</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>`);
    const entries = parseCompetitionProgram(html, 2026)[0].tuatEntries;
    expect(entries.map((e) => e.grade + e.name.split(" ")[0])).toEqual(["B2林", "B3岸田", "B2最上", "B2後藤"]);
    expect(entries.every((e) => e.heat === 3 && e.lane === 2)).toBe(true);
  });

  it("reads a six-runner squad (4x400mR lists reserves)", () => {
    const html = relay(`【4組】<font color='blue'><b>スタートリスト</b></font><br>
<table border=1>
<tr><td>7</td><td>農工大</td><td>東井 良太M1</td><td>陣立 智弘B4</td><td>正岡 優1</td><td>後藤 練B2</td><td>室井 維月1</td><td>八城 悠真1</td></tr>
</table>`);
    expect(parseCompetitionProgram(html, 2026)[0].tuatEntries).toHaveLength(6);
  });

  it("reads a relay result row even without the 結果 heading", () => {
    const html = relay(`【3組】
<table border=1>
<tr><td>2</td><td>42.55</td><td>農工大</td><td>林 夏輝2</td><td>岸田 健斗3</td><td>最上 瑛介2</td><td>後藤 練B2</td></tr>
</table>`);
    const entries = parseCompetitionProgram(html, 2026)[0].tuatEntries;
    expect(entries).toHaveLength(4);
    expect(entries[0].result).toEqual({ place: "2", record: "42.55" });
  });
});
