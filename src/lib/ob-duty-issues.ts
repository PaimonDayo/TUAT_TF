import type { EntryMember } from "./entry-identity";
import type { ObEntry } from "./ob-entries";
import { hasDuty, type ObDuty, type ObDutyRole } from "./ob-duty";
import { OB_DUTY_SLOTS, OB_MEET, obEventTime } from "./ob-meet";

export type ObDutyIssue = {
  key: string; time: string; event: string; kind: "competition" | "concurrent" | "ineligible" | "role" | "shortage" | "excess";
  text: string; personId?: string; roleId?: string;
};

export function entryForDuty(personId: string, entries: ObEntry[]) {
  return entries.find(entry => entry.profile_id === personId || entry.id === personId);
}

/** The same start time is the known conflict boundary; empty cells do not promise availability. */
export function competingEvents(events: string[], time: string) {
  return events.filter(event => obEventTime(event) === time);
}

export function entryDutyConflicts(personId: string, events: string[], duties: ObDuty[]) {
  return duties.filter(duty => duty.meet_key === OB_MEET.meetKey && duty.profile_id === personId && hasDuty(duty) && competingEvents(events, duty.slot_time).length > 0);
}

/** Compute from the whole roster, never the visible/search-filtered rows. */
export function obDutyIssues(entries: ObEntry[], members: EntryMember[], duties: ObDuty[], roles: ObDutyRole[]): ObDutyIssue[] {
  const issues: ObDutyIssue[] = [];
  const active = duties.filter(duty => duty.meet_key === OB_MEET.meetKey && hasDuty(duty));
  const invalid = new Set<ObDuty>();
  for (const duty of active) {
    const entry = entryForDuty(duty.profile_id, entries);
    const member = members.find(person => person.id === duty.profile_id);
    const name = member?.display_name ?? entry?.submitted_name ?? "名簿確認待ち";
    const base = { time: duty.slot_time, event: duty.event_name, personId: duty.profile_id };
    const add = (kind: ObDutyIssue["kind"], text: string) => {
      invalid.add(duty);
      issues.push({ ...base, kind, key: `${duty.profile_id}/${duty.slot_time}/${duty.event_name}/${kind}`, text });
    };
    if (!entry || entry.grade === "OB・OG" || entry.profile_id && !member) add("ineligible", `${name}：補助員の参加情報を確認してください`);
    const events = competingEvents(entry?.events ?? [], duty.slot_time);
    if (events.length) add("competition", `${name}：${events.join("・")}の出場と重複しています`);
    const others = active.filter(other => other.profile_id === duty.profile_id && other.slot_time === duty.slot_time && other.event_name !== duty.event_name);
    if (others.length) add("concurrent", `${name}：${[...new Set(others.map(other => other.event_name))].join("・")}の補助担当と重複しています`);
    if (duty.role_ids?.some(id => !roles.some(role => role.id === id && role.meet_key === duty.meet_key && role.slot_time === duty.slot_time && role.event_name === duty.event_name))) add("role", `${name}：担当の役職を確認してください`);
  }
  for (const role of roles.filter(role => role.meet_key === OB_MEET.meetKey)) {
    const assigned = active.filter(duty => duty.slot_time === role.slot_time && duty.event_name === role.event_name && duty.role_ids?.includes(role.id));
    const available = new Set(assigned.filter(duty => !invalid.has(duty)).map(duty => duty.profile_id)).size;
    const count = new Set(assigned.map(duty => duty.profile_id)).size;
    if (available < role.required_count) issues.push({ key: `${role.id}/shortage`, time: role.slot_time, event: role.event_name, kind: "shortage", roleId: role.id, text: `${role.name}：${role.required_count - available}人不足しています（担当可能 ${available} / 必要 ${role.required_count}人）` });
    if (count > role.required_count) issues.push({ key: `${role.id}/excess`, time: role.slot_time, event: role.event_name, kind: "excess", roleId: role.id, text: `${role.name}：必要人数を${count - role.required_count}人超えています` });
  }
  return issues.sort((a, b) => a.time.localeCompare(b.time) || OB_DUTY_SLOTS.findIndex(slot => slot.time === a.time && slot.label === a.event) - OB_DUTY_SLOTS.findIndex(slot => slot.time === b.time && slot.label === b.event));
}
