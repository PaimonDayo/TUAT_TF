import { OB_DUTY_SLOTS, OB_MEET, dutyTimeCell, isCompeting } from "./ob-meet";
import type { ObEntry } from "./ob-entries";

export type ObDuty = { meet_key: string; profile_id: string; slot_time: string; event_name: string; assignment: string; revision: number; role_ids?: string[] };
export type ObEntryDuty = Omit<ObDuty,"profile_id"> & {entry_id:string};
/** UIの人物キーへ変換するだけで、保存先の参加回答IDは変更しない。 */
export function entryDutiesForRoster(duties:ObEntryDuty[], entries:ObEntry[]):ObDuty[] {
  return duties.map(d=>({...d,profile_id:entries.find(e=>e.id===d.entry_id)?.profile_id??d.entry_id}));
}
export function combineObDuties(legacy:ObDuty[], entryDuties:ObEntryDuty[], entries:ObEntry[]):ObDuty[] {
  const result=new Map<string,ObDuty>();
  for(const duty of [...legacy,...entryDutiesForRoster(entryDuties,entries)]) {
    const key=JSON.stringify([duty.meet_key,duty.profile_id,duty.slot_time,duty.event_name]);
    const previous=result.get(key);
    if(previous&&hasDuty(previous)&&hasDuty(duty))throw new Error("補助員の担当が重複しています。担当者に確認してください");
    if(!previous||!hasDuty(previous))result.set(key,duty);
  }
  return [...result.values()];
}
export type DutyEdit = { profileId: string; slotTime: string; eventName: string; assignment: string; revision: number | null };
export const DUTY_TIMES = ["10:00","10:30","11:00","11:40","13:00","13:30","14:30","15:00","15:30"];
export function validDutyEdit(value: DutyEdit): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.profileId) &&
    OB_DUTY_SLOTS.some((slot) => slot.time === value.slotTime && slot.label === value.eventName) && typeof value.assignment === "string" && value.assignment.length <= 200 &&
    (value.revision === null || Number.isSafeInteger(value.revision) && value.revision >= 0);
}

export type ObDutyRole = {id:string;meet_key:string;slot_time:string;event_name:string;name:string;abbreviation:string;required_count:number;revision:number};
export type DutyRoleEdit = {id:string|null;slotTime:string;eventName:string;name:string;abbreviation:string;requiredCount:number;revision:number|null};
export type DutyRoleDelete = {id:string;slotTime:string;eventName:string;revision:number};
export type DutyRolesEdit = Omit<DutyEdit,"assignment"> & {roleIds:string[];entryId?:string};
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validDutyRolesEdit(v:DutyRolesEdit) {return !!v && (v.entryId===undefined||uuid(v.entryId)) && validDutyEdit({...v,assignment:""}) && Array.isArray(v.roleIds) && v.roleIds.length<=20 && v.roleIds.every(uuid) && new Set(v.roleIds).size===v.roleIds.length;}
export function validDutyRoleDelete(v:DutyRoleDelete) {return !!v&&uuid(v.id)&&Number.isSafeInteger(v.revision)&&v.revision>=0&&OB_DUTY_SLOTS.some(s=>s.time===v.slotTime&&s.label===v.eventName);}
export function validDutyRoleEdit(v:DutyRoleEdit) {return !!v && OB_DUTY_SLOTS.some(s=>s.time===v.slotTime&&s.label===v.eventName) && (v.id===null?v.revision===null:uuid(v.id)&&Number.isSafeInteger(v.revision)&&v.revision!>=0) && typeof v.name==="string" && v.name.trim().length>0 && v.name.length<=200 && typeof v.abbreviation==="string" && v.abbreviation.trim().length>0 && v.abbreviation.length<=8 && Number.isInteger(v.requiredCount)&&v.requiredCount>=0&&v.requiredCount<=99;}
export function dutyRoleText(duty:ObDuty|undefined,roles:ObDutyRole[],short=false) {if(!duty)return "";return duty.role_ids?.length?duty.role_ids.map(id=>roles.find(r=>r.id===id)).map(r=>r?(short?r.abbreviation:r.name):"?").join("・"):duty.assignment;}

export function hasDuty(duty: ObDuty): boolean {
  return !!(duty.role_ids?.length || duty.assignment.trim());
}

/** 同種目の兼務は許可し、別時刻・別大会・解除済みの行は妨げない。 */
export function concurrentDuties(profileId: string, time: string, event: string, duties: ObDuty[]): ObDuty[] {
  return duties.filter(d => d.meet_key === OB_MEET.meetKey && d.profile_id === profileId && d.slot_time === time && d.event_name !== event && hasDuty(d));
}

export type DutyCommitment = { time: string; label: string; kind: "競技" | "補助員"; detail: string };

/** 直前／直後の開始時刻にある予定をすべて返す。終了時刻や空き時間とはみなさない。 */
export function adjacentCommitments(entry: Pick<ObEntry, "events"> | undefined, profileId: string, time: string, duties: ObDuty[], roles: ObDutyRole[], direction: "previous" | "next"): DutyCommitment[] {
  const times = DUTY_TIMES.filter(t => direction === "previous" ? t < time : t > time);
  if (direction === "previous") times.reverse();
  for (const at of times) {
    const slot = OB_DUTY_SLOTS.find(s => s.time === at)!;
    const cell = dutyTimeCell(entry, slot);
    const commitments: DutyCommitment[] = !slot.note && isCompeting(cell) ? [{time: at, label: cell, kind: "競技", detail: "出場"}] : [];
    for (const duty of duties.filter(d => d.meet_key === OB_MEET.meetKey && d.profile_id === profileId && d.slot_time === at && hasDuty(d))) {
      commitments.push({time: at, label: duty.event_name, kind: "補助員", detail: dutyRoleText(duty, roles)});
    }
    if (commitments.length) return commitments;
  }
  return [];
}

export function nextCommitment(entry: Pick<ObEntry, "events"> | undefined, profileId: string, afterTime: string, duties: ObDuty[], roles: ObDutyRole[]): DutyCommitment | null {
  return adjacentCommitments(entry, profileId, afterTime, duties, roles, "next")[0] ?? null;
}
