import { emptyPerformance, withoutMeetPlacement, type MeetEventData, type MeetEventRule, type MeetPerformance } from "./meet-operations";
import { fieldOrderRows } from "./meet-field-order";

export type MeetParticipant = { id: string; competition_id: string; profile_id: string | null; name: string; grade: string; absent: boolean; deleted: boolean; revision: number };
export type MeetAppearance = { id: string; competition_id: string; participant_id: string; event_name: string; ordinal: number; operation_key: string; qualification_mark: string | null; state: "registered" | "cancelled" | "deleted"; performance: MeetPerformance; revision: number };
export type ManagedMeetEvent = { competition_id: string; name: string; family: string; division: "男子" | "女子" | "混合"; starts_at: string | null; sort_order: number; discipline: MeetEventRule["discipline"]; wind: boolean; capacity: number | null; confirmed: boolean; revision: number };
export type MeetDuty = { id: string; participant_id: string; slot_time: string; event_name: string; assignment: string; role_ids: string[]; revision: number; source: string };
export type MeetDutyRole = { id: string; slot_time: string; event_name: string; name: string; required_count: number; revision: number; abbreviation?:string };
export type MeetParty = { id: string; participant_id: string | null; name: string; group_label: string; status: "参加" | "不参加" | "未回答"; needs_review: boolean; revision: number };
export type CompetitionMeet = { competitionId: string; name: string; meetKey: string; backend: "pc" | "cloud"; program?: {time:string;label:string;events:string[];note?:string}[]; partyInfo?: {time:string;venue:string;fee:number}|null; staffRoleId?:string|null; roleOptions?:{id:string;name:string}[]; participants: MeetParticipant[]; appearances: MeetAppearance[]; events: ManagedMeetEvent[]; duties: MeetDuty[]; roles: MeetDutyRole[]; party: MeetParty[]; permissions: { manage: boolean; groups: boolean; record: boolean; register?:boolean; configure: boolean; history?:boolean }; members: { id: string; display_name: string; grade: string | null }[] };
export type MeetCommand = { backend?: "pc" | "cloud"; expectedConfirmed?: boolean; confirmDuties?:boolean; action: "participant.save" | "participant.attendance" | "participant.delete" | "participant.restore" | "appearance.add" | "appearance.edit" | "appearance.moveDivision" | "appearance.cancel" | "appearance.delete" | "appearance.restore" | "event.save" | "event.configure" | "duty.save" | "role.save" | "role.delete" | "party.save" | "meet.configure"; id?: string; revision?: number; name?: string; grade?: string; profileId?: string | null; absent?: boolean; participantId?: string; event?: string; mark?: string | null; changes?: { id: string; revision: number; performance: MeetPerformance }[]; confirmed?: boolean; roleIds?: string[]; assignment?: string; status?: string; time?:string; requiredCount?:number; staffRoleId?:string|null; expectedStaffRoleId?:string|null; config?: Omit<ManagedMeetEvent, "competition_id" | "revision" | "confirmed"> };
export type MeetMutationResult = { ok: boolean; message?: string; uncertain?: boolean; notSaved?: boolean; stale?: boolean; requestId?: string; id?: string };

export function availableAppearance(person: MeetParticipant | undefined, appearance: MeetAppearance) {
  return !!person && !person.deleted && !person.absent && appearance.state === "registered";
}
export function appearancePerformance(person: MeetParticipant | undefined, appearance: MeetAppearance): MeetPerformance {
  const value = { ...appearance.performance, entryId: appearance.id };
  return availableAppearance(person, appearance) && value.status !== "DNS" ? value : withoutMeetPlacement({ ...value, status: "DNS" });
}
export function competitionEventData(meet: Pick<CompetitionMeet, "participants" | "appearances">, event: ManagedMeetEvent): MeetEventData {
  const people = new Map(meet.participants.map(person => [person.id, person]));
  return { confirmed: event.confirmed, participants: meet.appearances.filter(value => value.event_name === event.name).map(value => appearancePerformance(people.get(value.participant_id), value)) };
}
export function meetEventCounts(meet: Pick<CompetitionMeet, "participants" | "appearances">, event: ManagedMeetEvent) {
  const data = competitionEventData(meet, event);
  const active = data.participants.filter(value => value.status === "entered");
  const ids = new Set(active.map(value => meet.appearances.find(appearance => appearance.id === value.entryId)!.participant_id));
  return { people: ids.size, appearances: active.length, dns: data.participants.filter(value => value.status === "DNS").length, dnf: data.participants.filter(value => value.status === "DNF").length, dq: data.participants.filter(value => value.status === "DQ").length };
}
export function newAppearancePerformance(id: string) { return emptyPerformance(id); }
export function meetRule(event: ManagedMeetEvent): MeetEventRule { return { name: event.name, discipline: event.discipline, wind: event.wind }; }
export function meetDutyText(duty: MeetDuty, roles: MeetDutyRole[]) { return duty.role_ids.length ? duty.role_ids.map(id => roles.find(role => role.id === id)?.name ?? "担当確認中").join("・") : duty.assignment; }

/** Board-only group namespaces; stored group numbers and heat scopes remain explicit. */
export function meetBoardGroup(group: number, scope: string) { return group + (scope === "混合" ? 198 : scope === "女子" ? 99 : 0); }
export function meetBoardPlacement(group: number) { return { group: (group - 1) % 99 + 1, heatScope: (group > 198 ? "混合" : group > 99 ? "女子" : "男子") as ManagedMeetEvent["division"] }; }
export function meetBoardGroupLabel(group: number) { const value=meetBoardPlacement(group);return `${value.heatScope}${value.group}組`; }
export function competitionFamilyData(meet: Pick<CompetitionMeet,"participants"|"appearances"|"events">, event: ManagedMeetEvent): MeetEventData {
  const events=meet.events.filter(e=>e.family===event.family), people=new Map(meet.participants.map(p=>[p.id,p]));
  return {confirmed:events.some(e=>e.confirmed),participants:meet.appearances.filter(a=>events.some(e=>e.name===a.event_name)).map(a=>{
    const value=appearancePerformance(people.get(a.participant_id),a),definition=events.find(e=>e.name===a.event_name)!;
    return value.group===null?value:{...value,group:meetBoardGroup(value.group,value.heatScope??definition.division)};
  })};
}
export function storedMeetPerformance(value: MeetPerformance): MeetPerformance { return value.group===null?value:{...value,...meetBoardPlacement(value.group)}; }

/** Identify an independent appearance by its actual placement, never its internal ordinal. */
export function meetAppearancePositionLabel(meet: Pick<CompetitionMeet,"participants"|"appearances"|"events">, appearance: MeetAppearance) {
  const event=meet.events.find(e=>e.name===appearance.event_name);
  if(!event)return "種目確認中";
  const person=meet.participants.find(p=>p.id===appearance.participant_id),performance=appearancePerformance(person,appearance);
  if(event.discipline==="track")return performance.group===null?"組未定":`${performance.heatScope??event.division}${performance.group}組 ${performance.order??"未定"}${event.capacity?"レーン":"番"}`;
  const number=fieldOrderRows(competitionFamilyData(meet,event)).find(row=>row.person.entryId===appearance.id)?.number;
  return number==null?"試技順未定":`試技順 ${number}番`;
}
export function meetDutyConflict(meet:Pick<CompetitionMeet,"participants"|"appearances"|"events">, participantId:string,time:string) {
  const person=meet.participants.find(p=>p.id===participantId);
  return meet.appearances.some(a=>a.participant_id===participantId&&meet.events.find(e=>e.name===a.event_name)?.starts_at===time&&((availableAppearance(person,a)&&a.performance.status!=="DNS")||a.performance.status==="DNF"||a.performance.status==="DQ"||a.performance.trials.some(t=>t.status!=="pending"||!!t.mark||!!t.wind)));
}

export function meetDutyEvents(meet:Pick<CompetitionMeet,"events"|"roles"|"program">) { return [...new Set([...meet.events.map(e=>e.family),...meet.roles.map(r=>r.event_name),...(meet.program??[]).filter(s=>s.note).map(s=>s.label)])]; }
