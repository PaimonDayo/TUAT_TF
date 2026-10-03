import { expect, it } from "vitest";
import { competingEvents, entryDutyConflicts, obDutyIssues } from "./ob-duty-issues";
import type { ObEntry } from "./ob-entries";
import type { ObDuty, ObDutyRole } from "./ob-duty";
const entry:ObEntry={id:"e",profile_id:"m",meet_key:"ob-2026",submitted_name:"合成人物",grade:"B1",events:["男子100m"],qualification_marks:{},revision:0,imported_at:""};
const members=[{id:"m",display_name:"合成人物",grade:"B1"}];
const role:ObDutyRole={id:"r",meet_key:"ob-2026",slot_time:"11:00",event_name:"砲丸投げ",name:"計測",abbreviation:"測",required_count:1,revision:0};
const duty:ObDuty={meet_key:"ob-2026",profile_id:"m",slot_time:"11:00",event_name:"砲丸投げ",assignment:"計測",role_ids:["r"],revision:0};
it("finds another concurrent competition and counts an unavailable helper as a shortage",()=>{
 const issues=obDutyIssues([entry],members,[duty],[role]);
 expect(issues.map(issue=>issue.kind)).toEqual(["competition","shortage"]);
 expect(issues[0]).toMatchObject({time:"11:00",event:"砲丸投げ",personId:"m"});
 expect(issues[1].text).toContain("担当可能 0 / 必要 1");
 expect(entryDutyConflicts("m",["男子100m"],[duty])).toEqual([duty]);
});
it("cleared assignments and other meets never create false conflicts",()=>{
 expect(entryDutyConflicts("m",entry.events,[{...duty,assignment:"",role_ids:[]},{...duty,meet_key:"other"}])).toEqual([]);
 expect(obDutyIssues([entry],members,[{...duty,assignment:"",role_ids:[]}],[role]).map(issue=>issue.kind)).toEqual(["shortage"]);
 expect(competingEvents(["女子立ち五段","女子100m"],"10:30")).toEqual(["女子立ち五段"]);
});
it("finds both ends of a double assignment without treating same-event multiple roles as double booking",()=>{
 const entryWithoutEvents={...entry,events:[]};
 const another={...duty,event_name:"100m",role_ids:[],assignment:"計時"};
 expect(obDutyIssues([entryWithoutEvents],members,[duty,another],[role]).filter(issue=>issue.kind==="concurrent")).toHaveLength(2);
 expect(obDutyIssues([entryWithoutEvents],members,[duty],[role])).toEqual([]);
});
it("handles unlinked helpers, missing participants, inactive profiles, wrong roles and alumni",()=>{
 expect(obDutyIssues([{...entry,profile_id:null}],[],[{...duty,profile_id:"e"}],[role])).toEqual(expect.arrayContaining([expect.objectContaining({kind:"competition"})]));
 expect(obDutyIssues([{...entry,profile_id:null,events:[]}],[],[{...duty,profile_id:"e"}],[role])).toEqual([]);
 for(const entries of [[],[entry],[{...entry,grade:"OB・OG"}]])expect(obDutyIssues(entries,[],[duty],[role]).some(issue=>issue.kind==="ineligible")).toBe(true);
 expect(obDutyIssues([{...entry,events:[]}],members,[{...duty,role_ids:["unknown"]}],[role]).map(issue=>issue.kind)).toEqual(["role","shortage"]);
});
it("reports overfilled roles and does not modify the input roster",()=>{
 const before=JSON.stringify([entry,duty,role]);
 expect(obDutyIssues([{...entry,events:[]}],members,[duty],[{...role,required_count:0}])[0].kind).toBe("excess");
 expect(JSON.stringify([entry,duty,role])).toBe(before);
});
it("invalidates review after assignment changes while ignoring unrelated entry edits",()=>{
 const original=obDutyIssues([entry],members,[duty],[role])[0].fingerprint;
 expect(obDutyIssues([{...entry,revision:2}],members,[duty],[role])[0].fingerprint).toBe(original);
 expect(obDutyIssues([entry],members,[duty],[role,{...role,id:"unrelated",revision:3}])[0].fingerprint).toBe(original);
 expect(obDutyIssues([entry],members,[{...duty,revision:1}],[role])[0].fingerprint).not.toBe(original);
});
