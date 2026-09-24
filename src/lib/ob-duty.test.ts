import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {DUTY_TIMES,validDutyEdit} from "./ob-duty";
import {OB_DUTY_SLOTS} from "./ob-meet";
const input={profileId:"10000000-0000-4000-8000-000000000001",slotTime:"10:00",assignment:"周回表示",revision:null};
it("accepts new duties, edits and clearing without accepting invalid inputs",()=>{
  expect(validDutyEdit(input)).toBe(true);
  expect(validDutyEdit({...input,assignment:"",revision:2})).toBe(true);
  for(const change of [{profileId:"invalid"},{slotTime:"12:34"},{assignment:"x".repeat(201)},{revision:-1},{revision:1.5}]) expect(validDutyEdit({...input,...change})).toBe(false);
});
it("keeps form, schedule and database slot validation aligned",()=>{
  expect(DUTY_TIMES).toEqual(OB_DUTY_SLOTS.map(s=>s.time));
  const sql=readFileSync(new URL("../../supabase/migrations/20260924080000_ob_duties.sql",import.meta.url),"utf8");
  for(const time of DUTY_TIMES)expect(sql).toContain(`'${time}'`);
});
