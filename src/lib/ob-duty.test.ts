import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {DUTY_TIMES,validDutyEdit} from "./ob-duty";
import {OB_DUTY_SLOTS} from "./ob-meet";
const input={profileId:"10000000-0000-4000-8000-000000000001",slotTime:"10:00",eventName:"1500m",assignment:"周回表示",revision:null};
it("accepts new duties, edits and clearing without accepting invalid inputs",()=>{
  expect(validDutyEdit(input)).toBe(true);
  expect(validDutyEdit({...input,assignment:"",revision:2})).toBe(true);
  for(const change of [{profileId:"invalid"},{slotTime:"12:34"},{eventName:"100m"},{assignment:"x".repeat(201)},{revision:-1},{revision:1.5}]) expect(validDutyEdit({...input,...change})).toBe(false);
});
it("keeps form, schedule and database slot validation aligned",()=>{
  expect(DUTY_TIMES).toEqual([...new Set(OB_DUTY_SLOTS.map(s=>s.time))]);
  const sql=readFileSync(new URL("../../supabase/migrations/20260924080000_ob_duties.sql",import.meta.url),"utf8");
  for(const time of DUTY_TIMES)expect(sql).toContain(`'${time}'`);
});

it("validates multiple selected role IDs and rejects duplicates", async()=>{
 const {validDutyRolesEdit}=await import("./ob-duty");
 const role="20000000-0000-4000-8000-000000000001";
 expect(validDutyRolesEdit({...input,roleIds:[]})).toBe(true);
 expect(validDutyRolesEdit({...input,roleIds:[role]})).toBe(true);
 expect(validDutyRolesEdit({...input,roleIds:[role,role]})).toBe(false);
 expect(validDutyRolesEdit({...input,roleIds:["bad"]})).toBe(false);
});
it("validates staffing targets and uses updated names and abbreviations by stable role ID",async()=>{
 const {validDutyRoleEdit,dutyRoleText}=await import("./ob-duty");
 const role={id:input.profileId,meet_key:"ob-2026",slot_time:"10:00",event_name:"1500m",name:"計時",abbreviation:"計",required_count:2,revision:0};
 const edit={id:null,slotTime:"10:00",eventName:"1500m",name:"計時",abbreviation:"計",requiredCount:2,revision:null};
 expect(validDutyRoleEdit(edit)).toBe(true);
 for(const change of [{requiredCount:-1},{requiredCount:1.5},{requiredCount:100},{name:" "},{abbreviation:""}])expect(validDutyRoleEdit({...edit,...change})).toBe(false);
 const duty={meet_key:"ob-2026",profile_id:input.profileId,slot_time:"10:00",event_name:"1500m",assignment:"old name",role_ids:[role.id],revision:0};
 expect(dutyRoleText(duty,[role])).toBe("計時");expect(dutyRoleText(duty,[role],true)).toBe("計");
});

it("finds the next competition or helper duty after a time", async()=>{
 const {nextCommitment}=await import("./ob-duty");
 const role={id:"20000000-0000-4000-8000-000000000001",meet_key:"ob-2026",slot_time:"11:00",event_name:"100m",name:"計時",abbreviation:"計",required_count:2,revision:0};
 const duty={meet_key:"ob-2026",profile_id:input.profileId,slot_time:"11:00",event_name:"100m",assignment:"",role_ids:[role.id],revision:0};
 const entry={events:["男子300m"]};
 expect(nextCommitment(entry,input.profileId,"10:00",[duty],[role])).toEqual({time:"11:00",label:"100m",kind:"補助員",detail:"計時"});
 expect(nextCommitment(entry,input.profileId,"11:00",[duty],[role])).toEqual({time:"13:30",label:"300m",kind:"競技",detail:"出場"});
 expect(nextCommitment(entry,input.profileId,"13:30",[duty],[role])).toBeNull();
});
it("orders grades from B1", async()=>{
 const {compareByGrade}=await import("./ob-meet");
 const rows=[{grade:"M1",name:"a"},{grade:"B3",name:"b"},{grade:"D1",name:"c"},{grade:"1",name:"d"},{grade:"OB・OG",name:"e"}];
 expect(rows.sort(compareByGrade).map(r=>r.name)).toEqual(["d","b","a","c","e"]);
});
