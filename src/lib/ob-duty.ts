import { OB_DUTY_SLOTS, dutyTimeCell, isCompeting } from "./ob-meet";
import type { ObEntry } from "./ob-entries";

export type ObDuty = { meet_key: string; profile_id: string; slot_time: string; event_name: string; assignment: string; revision: number; role_ids?: string[] };
export type DutyEdit = { profileId: string; slotTime: string; eventName: string; assignment: string; revision: number | null };
export const DUTY_TIMES = ["10:00","10:30","11:00","11:40","13:00","13:30","14:30","15:00","15:30"];
export function validDutyEdit(value: DutyEdit): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.profileId) &&
    OB_DUTY_SLOTS.some((slot) => slot.time === value.slotTime && slot.label === value.eventName) && typeof value.assignment === "string" && value.assignment.length <= 200 &&
    (value.revision === null || Number.isSafeInteger(value.revision) && value.revision >= 0);
}

export type ObDutyRole = {id:string;meet_key:string;slot_time:string;event_name:string;name:string;abbreviation:string;required_count:number;revision:number};
export type DutyRoleEdit = {id:string|null;slotTime:string;eventName:string;name:string;abbreviation:string;requiredCount:number;revision:number|null};
export type DutyRolesEdit = Omit<DutyEdit,"assignment"> & {roleIds:string[]};
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validDutyRolesEdit(v:DutyRolesEdit) {return !!v && validDutyEdit({...v,assignment:""}) && Array.isArray(v.roleIds) && v.roleIds.length<=20 && v.roleIds.every(uuid) && new Set(v.roleIds).size===v.roleIds.length;}
export function validDutyRoleEdit(v:DutyRoleEdit) {return !!v && OB_DUTY_SLOTS.some(s=>s.time===v.slotTime&&s.label===v.eventName) && (v.id===null?v.revision===null:uuid(v.id)&&Number.isSafeInteger(v.revision)&&v.revision!>=0) && typeof v.name==="string" && v.name.trim().length>0 && v.name.length<=200 && typeof v.abbreviation==="string" && v.abbreviation.trim().length>0 && v.abbreviation.length<=8 && Number.isInteger(v.requiredCount)&&v.requiredCount>=0&&v.requiredCount<=99;}
export function dutyRoleText(duty:ObDuty|undefined,roles:ObDutyRole[],short=false) {if(!duty)return "";return duty.role_ids?.length?duty.role_ids.map(id=>roles.find(r=>r.id===id)).map(r=>r?(short?r.abbreviation:r.name):"?").join("・"):duty.assignment;}

/**
 * その時刻より後で、次に入っている予定（出場か補助員）。補助員一覧で候補を選ぶときに、
 * 次の予定までの余裕を見られるようにする。同じ時刻に出場と補助員があれば出場を優先して出す。
 */
export function nextCommitment(entry: Pick<ObEntry, "events"> | undefined, profileId: string, afterTime: string, duties: ObDuty[], roles: ObDutyRole[]):
  { time: string; label: string; kind: "競技" | "補助員"; detail: string } | null {
  for (const slot of OB_DUTY_SLOTS.filter((s) => s.time > afterTime)) {
    const cell = dutyTimeCell(entry, slot);
    // 同時刻の別種目への出場も含む（cell はその時刻に出る種目名）
    if (!slot.note && isCompeting(cell)) return { time: slot.time, label: cell, kind: "競技", detail: "出場" };
    const duty = duties.find((d) => d.profile_id === profileId && d.slot_time === slot.time && d.event_name === slot.label && (d.role_ids?.length || d.assignment));
    if (duty) return { time: slot.time, label: slot.label, kind: "補助員", detail: dutyRoleText(duty, roles) };
  }
  return null;
}
