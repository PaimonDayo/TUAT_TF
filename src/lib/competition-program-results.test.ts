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
