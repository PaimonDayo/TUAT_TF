import { availableAppearance, meetDutyConflict, type CompetitionMeet, type MeetParticipant } from "./competition-meet";

export type MeetDutySlot = { time: string; event: string };
export function meetDutySlots(meet: CompetitionMeet): MeetDutySlot[] {
  const values = new Map<string, MeetDutySlot>();
  const add = (time: string | null, event: string) => { if (time) values.set(JSON.stringify([time, event]), { time, event }); };
  meet.events.forEach(e => add(e.starts_at, e.family));
  meet.roles.forEach(r => add(r.slot_time, r.event_name));
  meet.duties.forEach(d => { if (d.assignment || d.role_ids.length) add(d.slot_time, d.event_name); });
  meet.program?.filter(s => s.note).forEach(s => add(s.time, s.label));
  return [...values.values()].sort((a, b) => a.time.localeCompare(b.time) || a.event.localeCompare(b.event, "ja"));
}
export function meetDutyCell(meet: CompetitionMeet, person: MeetParticipant, slot: MeetDutySlot) {
  const appearances = meet.appearances.filter(a => a.participant_id === person.id && a.state !== "deleted" && meet.events.some(e => e.name === a.event_name && e.starts_at === slot.time));
  const competing = appearances.filter(a => availableAppearance(person, a) && a.performance.status !== "DNS");
  const duties = meet.duties.filter(d => d.participant_id === person.id && d.slot_time === slot.time && d.event_name === slot.event && (d.assignment || d.role_ids.length));
  const recordedConflict = meetDutyConflict(meet, person.id, slot.time);
  return { appearances, competing, duties, busy: recordedConflict, onDay: !!meet.program?.some(s => s.time === slot.time && s.label === slot.event && s.note), concurrent: competing.some(a => meet.events.find(e => e.name === a.event_name)?.family !== slot.event), needsReplacement: duties.length > 0 && (person.absent || person.deleted || recordedConflict) };
}
export function validRolePeople(meet: CompetitionMeet, roleId: string) {
  return new Set(meet.duties.filter(d => d.role_ids.includes(roleId) && !meetDutyConflict(meet, d.participant_id, d.slot_time) && meet.participants.some(p => p.id === d.participant_id && !p.absent && !p.deleted)).map(d => d.participant_id));
}
