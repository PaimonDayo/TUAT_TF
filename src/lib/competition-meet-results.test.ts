import { expect, it } from "vitest";
import { meetResultRows } from "./competition-meet-results";
import { meetDutyCell, meetDutySlots, validRolePeople } from "./competition-meet-duties";
import {fixtureMeet} from "./__fixtures__/competition-meet";


it("keeps independent repeated appearances, wind and overall ranks without sending operational/private fields",()=>{
  const meet=fixtureMeet(),before=structuredClone(meet),rows=meetResultRows(meet,"2026-10-13"), entries=rows[0].tuatEntries;
  expect(entries.map(e=>e.id)).toEqual(["a","b"]);
  expect(entries.map(e=>e.name)).toEqual(["同姓 同名","同姓 同名"]);
  expect(entries.map(e=>e.grade)).toEqual(["B1","B1"]);
  expect(entries.map(e=>e.positionLabel)).toEqual(["男子1組 1レーン","男子1組 2レーン"]);
  expect(entries.every(e=>e.separateResult)).toBe(true);
  expect(entries.map(e=>e.result)).toEqual([{place:"1",record:"11.00",wind:"+1.0"},{place:"2",record:"12.00",wind:"+1.0"}]);
  expect(JSON.stringify(rows)).not.toMatch(/private|qualification|role_ids|participant_id/);
  expect(JSON.stringify(rows)).not.toContain("件目");expect(meet).toEqual(before);
});
it("keeps same-name repeated starts and tied records independent by appearance ID and field order",()=>{
  const meet=fixtureMeet(),first=meet.appearances[0];
  meet.appearances[1].performance.trials=structuredClone(first.performance.trials);
  meet.appearances.push({...structuredClone(first),id:"same-name-other-person",participant_id:"two",ordinal:1,operation_key:"private-key-other",performance:{...structuredClone(first.performance),entryId:"same-name-other-person",order:3}});
  const rows=meetResultRows(meet,"2026-10-13"),entries=rows[0].tuatEntries;
  expect(entries.map(e=>e.id)).toEqual(["a","b","same-name-other-person"]);
  expect(entries.map(e=>e.name)).toEqual(["同姓 同名","同姓 同名","同姓 同名"]);
  expect(entries.map(e=>e.grade)).toEqual(["B1","B1","B2"]);
  expect(entries.map(e=>e.result)).toEqual(Array(3).fill({place:"1",record:"11.00",wind:"+1.0"}));
  expect(entries.every(e=>e.separateResult)).toBe(true);
  expect(rows[1].tuatEntries[0]).toMatchObject({id:"c",name:"同姓 同名",grade:"B2",positionLabel:"試技順 1番",result:{record:"5.00"}});
});
it("shows DNS and preserved trials after cancellation, keeps DNF/DQ out of rankings, and excludes deleted rows",()=>{
  const meet=fixtureMeet();meet.appearances[0].state="cancelled";meet.appearances[1].performance.status="DNF";meet.appearances[2].performance.status="DQ";
  const rows=meetResultRows(meet,"2026-10-13");expect(rows[0].tuatEntries[0]).toMatchObject({heat:null,lane:null,positionLabel:"組未定",result:{record:"DNS",place:null},details:["出場取消済み","試技1: 11.00（風 +1.0）"]});
  expect(rows[0].tuatEntries[1].result).toEqual({record:"DNF",place:null});expect(rows[1].tuatEntries[0].result).toEqual({record:"DQ",place:null});
  meet.appearances[0].state="deleted";expect(meetResultRows(meet,"2026-10-13")[0].tuatEntries).toHaveLength(1);
});
it("derives time columns from arbitrary events, duties and relay slots rather than an OB template",()=>{
  expect(meetDutySlots(fixtureMeet())).toEqual([{time:"10:00",event:"100m"},{time:"10:00",event:"走幅跳"},{time:"11:00",event:"リレー"}]);
});
it("keeps all repeated/concurrent appearances and flags retained assignments needing replacement",()=>{
  const meet=fixtureMeet(),cell=meetDutyCell(meet,meet.participants[0],{time:"10:00",event:"走幅跳"});
  expect(cell.competing.map(a=>a.id)).toEqual(["a","b"]);expect(cell).toMatchObject({concurrent:true,busy:true,needsReplacement:true});expect(validRolePeople(meet,"r")).toEqual(new Set(["three"]));
  meet.participants[2].absent=true;expect(validRolePeople(meet,"r").size).toBe(0);
  meet.participants[2].absent=false;meet.participants[2].deleted=true;expect(validRolePeople(meet,"r").size).toBe(0);
  meet.appearances[0].state="cancelled";meet.appearances[1].state="cancelled";expect(meetDutyCell(meet,meet.participants[0],{time:"10:00",event:"走幅跳"}).needsReplacement).toBe(true);
});
