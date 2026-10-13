import {expect,it} from "vitest";
import {emptyRelayResults,formatRelayTime,relayResultRow,relayResultSheet,reviewRelayResults,validateRelayResults} from "./competition-meet-relay";
import {fixtureMeet} from "./__fixtures__/competition-meet";
import {meetResultRows} from "./competition-meet-results";
import {competitionMeetObExport} from "./competition-meet-export";

it("keeps exactly six lanes and supports an unfinished team without accepting a time without a name",()=>{
 const teams=emptyRelayResults();expect(teams.map(t=>t.lane)).toEqual([1,2,3,4,5,6]);
 expect(validateRelayResults(teams)).toBeNull();teams[5].name="最終レーン";
 expect(validateRelayResults(teams)).toBeNull();expect(validateRelayResults(teams,true)).toContain("6レーン");
 teams[5].time="2:45.67";expect(validateRelayResults(teams,true)).toBeNull();
 teams[0].time="2:40.00";expect(validateRelayResults(teams)).toContain("1レーン");
 teams[0].name="入力";teams[0].time="2:99.00";expect(validateRelayResults(teams)).toContain("1レーン");
 expect(validateRelayResults([...teams,{...emptyRelayResults()[0],lane:7,name:"追加",time:""}])).not.toBeNull();
 expect(validateRelayResults(teams.map(t=>({...t,lane:1})))).not.toBeNull();
 expect(validateRelayResults(emptyRelayResults(),true)).not.toBeNull();
});
it("formats minute shorthand only on commit without rounding or changing lane identity",()=>{
 expect(formatRelayTime("２４５６７")).toBe("2:45.67");expect(formatRelayTime(" 2:45.67 ")).toBe("2:45.67");
 expect(formatRelayTime("2:")).toBe("2:");
});
it("keeps disjoint lane/field changes and resolves only conflicting fields",()=>{
 const base=emptyRelayResults(),draft=structuredClone(base),latest=structuredClone(base);
 draft[0].name="自分のチーム";latest[5]={...emptyRelayResults()[5],lane:6,name:"別チーム",time:"2:44.00"};
 const first=reviewRelayResults(base,draft,latest);expect(first.conflicts).toEqual([]);expect(first.teams[0]).toEqual(draft[0]);expect(first.teams[5]).toEqual(latest[5]);
 latest[0].name="最新のチーム";draft[0].time="2:46.00";
 const second=reviewRelayResults(base,draft,latest);expect(second.conflicts).toEqual([{key:"1:name",lane:1,field:"name",label:"チーム名",own:"自分のチーム",current:"最新のチーム"}]);
 expect(reviewRelayResults(base,draft,latest,{"1:name":"own"}).teams[0]).toEqual(draft[0]);
 expect(reviewRelayResults(base,draft,latest,{"1:name":"current"}).teams[0]).toEqual({...emptyRelayResults()[0],lane:1,name:"最新のチーム",time:"2:46.00"});
});
it("publishes independent team results and a six-lane sheet without registering fake people",()=>{
 const meet=fixtureMeet(),teams=emptyRelayResults();teams[0]={...emptyRelayResults()[0],lane:1,name:"同じチーム",time:"2:45.67"};teams[5]={...emptyRelayResults()[5],lane:6,name:"同じチーム",time:"2:45.67"};teams[2]={...emptyRelayResults()[2],lane:3,name:"記録待ち",time:""};
 const event={...meet.events[0],name:"4×300mリレー",family:"4×300mリレー",division:"混合" as const,starts_at:"15:30",capacity:6,wind:false,relay_results:teams};meet.events.push(event);const before=structuredClone(meet);
 const row=relayResultRow(event,"2026-10-13");expect(row.tuatEntries.map(e=>[e.id,e.name,e.positionLabel,e.result?.place])).toEqual([["4×300mリレー:1","同じチーム","1レーン","1"],["4×300mリレー:3","記録待ち","3レーン",undefined],["4×300mリレー:6","同じチーム","6レーン","1"]]);
 expect(row.tuatEntries.every(e=>e.separateResult)).toBe(true);expect(meetResultRows(meet,"2026-10-13").at(-1)).toEqual(row);
 const sheet=relayResultSheet(event);expect(sheet.rows).toHaveLength(7);expect(sheet.rows[6]).toEqual([6,"同じチーム","2:45.67",1,"","","",""]);
 const exported=competitionMeetObExport(meet);expect(exported.entries).toHaveLength(meet.appearances.length);expect(exported.operations.some(e=>e.event_name===event.name)).toBe(false);expect(exported.relaySheets).toEqual([sheet]);expect(meet).toEqual(before);
});
it("preserves each runner during concurrent roster edits and rejects malformed or orphaned members",()=>{
 const base=emptyRelayResults(),draft=structuredClone(base),latest=structuredClone(base);draft[0].name="チーム";latest[0].name="チーム";
 draft[0].members[0]="一走";latest[0].members[3]="四走";
 const merged=reviewRelayResults(base,draft,latest);expect(merged.conflicts).toEqual([]);expect(merged.teams[0].members).toEqual(["一走","","","四走"]);expect(latest[0].members).toEqual(["","","","四走"]);
 latest[0].members[0]="最新一走";expect(reviewRelayResults(base,draft,latest).conflicts[0]).toMatchObject({key:"1:member0",label:"1走",own:"一走",current:"最新一走"});
 expect(reviewRelayResults(base,draft,latest,{"1:member0":"own"}).teams[0].members).toEqual(["一走","","","四走"]);
 const orphan=emptyRelayResults();orphan[0].members[0]="氏名のみ";expect(validateRelayResults(orphan)).toContain("チーム名");
 orphan[0].name="チーム";expect(validateRelayResults(orphan)).toBeNull();orphan[0].members[0]="長".repeat(101);expect(validateRelayResults(orphan)).toContain("氏名");
 const meet=fixtureMeet(),event={...meet.events[0],relay_results:merged.teams};expect(relayResultRow(event,"2026-10-13").tuatEntries[0].details).toEqual(["1走 一走","4走 四走"]);expect(relayResultSheet(event).rows[1].slice(4)).toEqual(["一走","","","四走"]);
});
