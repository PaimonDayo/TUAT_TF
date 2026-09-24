import { OB_DUTY_SLOTS } from "./ob-meet";

export type ObDuty = { meet_key: string; profile_id: string; slot_time: string; event_name: string; assignment: string; revision: number };
export type DutyEdit = { profileId: string; slotTime: string; eventName: string; assignment: string; revision: number | null };
export const DUTY_TIMES = ["10:00","10:30","11:00","11:40","13:00","13:30","14:30","15:00","15:30"];
export function validDutyEdit(value: DutyEdit): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.profileId) &&
    OB_DUTY_SLOTS.some((slot) => slot.time === value.slotTime && slot.label === value.eventName) && typeof value.assignment === "string" && value.assignment.length <= 200 &&
    (value.revision === null || Number.isSafeInteger(value.revision) && value.revision >= 0);
}
