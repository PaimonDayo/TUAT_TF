import { expect,it } from "vitest";
import { OB_PROGRAM, OB_DUTY_SLOTS, dutyCell, dutyTimeCell, dutyRows, partyCounts, obCsvCell, validPartyEdit, type ObPartyResponse } from "./ob-meet";
import { OB_ENTRY_EVENTS, validEntryEdit } from "./ob-entry-edit";
import type { ObEntry } from "./ob-entries";
const entry = {id:"e",grade:"B2",submitted_name:"確認太郎",profile_id:"p",events:["男子100m","男子砲丸投げ"]} as ObEntry;
it("separates concurrent helper events while retaining concurrent competition warnings",()=>{
  expect(OB_DUTY_SLOTS).toHaveLength(12);
  expect(OB_DUTY_SLOTS.filter(s=>s.time==="11:00").map(s=>s.label)).toEqual(["100m","砲丸投げ"]);
  expect(OB_DUTY_SLOTS.every(s=>s.events.length<=1)).toBe(true);
  const shot=OB_DUTY_SLOTS.find(s=>s.label==="砲丸投げ")!;
  expect(dutyTimeCell({events:["男子100m"]},shot)).toBe("100m");
});
it("maps all entry events to the supplied program exactly once and keeps relay same-day only",()=>{
  for(const event of OB_ENTRY_EVENTS) expect(OB_PROGRAM.filter(s=>s.events.includes(event.slice(2)))).toHaveLength(1);
  expect(OB_PROGRAM.map(s=>s.time)).toEqual(["09:00","09:30","10:00","10:30","11:00","11:40","12:20","13:00","13:30","14:30","15:00","15:30","16:00"]);
  expect(OB_DUTY_SLOTS.at(-1)?.note).toBe("当日エントリー");
});
it("shows concurrent events without claiming free time or hiding missing answers",()=>{
  const slot=OB_PROGRAM.find(s=>s.time==="11:00")!;
  expect(dutyCell(entry,slot)).toBe("100m・砲丸投げ");
  expect(dutyCell({events:[]},slot)).toBe("出場登録なし");
  expect(dutyCell(undefined,slot)).toBe("エントリー未確認");
  expect(dutyCell(entry,OB_DUTY_SLOTS.at(-1)!)).toBe("当日確認");
});
it("keeps unconfirmed identities separate and avoids duplicating confirmed members",()=>{
  const members=[{id:"p",display_name:"確認 太郎",grade:"2"},{id:"q",display_name:"確認花子",grade:"1"}];
  expect(dutyRows([entry],members)).toHaveLength(2);
  const rows=dutyRows([{...entry,profile_id:null}],members);
  expect(rows).toHaveLength(3);expect(rows.filter(r=>!r.linked)).toHaveLength(1);
});
it("includes senior and unentered active members as helper candidates",()=>{
  const members=[{id:"p",display_name:"B2 member",grade:"2"},{id:"q",display_name:"B3 member",grade:"3"},{id:"r",display_name:"no entry",grade:"1"}];
  const rows=dutyRows([entry,{...entry,id:"senior",profile_id:"q",grade:"B3"},{...entry,id:"junior",profile_id:null,grade:"B1"},{...entry,id:"graduate",profile_id:null,grade:"M1"}],members);
  expect(rows.map(r=>r.id)).toEqual(["r","junior","p","q","graduate"]);
});
it("does not treat alumni competitors as unconfirmed student helpers",()=>{
  const alumni={...entry,id:"alumni",profile_id:null,grade:"OB・OG"};
  expect(dutyRows([entry,alumni],[{id:"p",display_name:"確認太郎",grade:"2"}])).toHaveLength(1);
});
it("excludes held names from attendance totals",()=>{
  const responses=[{status:"参加",needs_review:false},{status:"参加",needs_review:true},{status:"不参加",needs_review:false},{status:"未回答",needs_review:false}] as ObPartyResponse[];
  expect(partyCounts(responses)).toEqual({attending:1,absent:1,unknown:1,held:1});
});
it("escapes CSV text and neutralises formula prefixes",()=>{
  expect(obCsvCell('田中,"太郎"')).toBe('"田中,""太郎"""');
  expect(obCsvCell(' =HYPERLINK("test")')).toBe('"\' =HYPERLINK(""test"")"');
});
it("validates party status and optimistic revision and permits explicit party-only registration",()=>{
  expect(validPartyEdit({id:null,revision:null,status:"参加"})).toBe(true);
  expect(validPartyEdit({id:"bad",revision:0,status:"参加"})).toBe(false);
  expect(validPartyEdit({id:null,revision:0,status:"参加"})).toBe(false);
  expect(validPartyEdit({id:null,revision:null,status:"unknown" as "参加"})).toBe(false);
  const input={entryId:null,profileId:"10000000-0000-4000-8000-000000000001",revision:null,events:[],marks:{}};
  expect(validEntryEdit(input,true)).toBe(true);expect(validEntryEdit(input)).toBe(false);
});
