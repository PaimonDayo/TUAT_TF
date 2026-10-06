import { isAlumniEntry, type ObEntry } from "./ob-entries";
import { dutyRows, OB_DUTY_SLOTS, OB_MEET } from "./ob-meet";
import type { EntryMember } from "./entry-identity";
import { emptyPerformance, type MeetEventData, type MeetEventRule, type MeetPerformance } from "./meet-operations";

export type ObEventOperation = { meet_key: string; event_name: string; revision: number; data: MeetEventData; updated_at: string };
export type ObParticipationStatus = MeetPerformance["status"] | "absent" | "withdrawn" | "missing";

/** Editable lane frames; existing saved positions outside them remain visible. */
export function obHeatCapacity(event: string): 8 | 6 | undefined {
  if (/^(男子|女子)100m$/.test(event)) return 8;
  if (/^(男子|女子)(300m|300mH)$/.test(event)) return 6;
  return undefined;
}

/** DNS is a declaration, not a completed performance. DNF/DQ and all attempted trials are historical results. */
export function hasRecordedObPerformance(performance?: MeetPerformance): boolean {
  return !!performance && (performance.status === "DNF" || performance.status === "DQ" || performance.trials.some(trial => trial.status !== "pending" || !!trial.mark || !!trial.wind));
}

/** Registration changes cannot erase the fact that somebody competed at this time. */
export function obDutyCompetitionEvents(entry: (Pick<ObEntry, "events"> & Partial<Pick<ObEntry, "id">>) | undefined, operations: ObEventOperation[] = []) {
  const recorded = operations.filter(operation => operation.meet_key === OB_MEET.meetKey && operation.data.participants.some(person => person.entryId === entry?.id && hasRecordedObPerformance(person))).map(operation => operation.event_name);
  return [...new Set([...(entry?.events ?? []), ...recorded])];
}

/** Keep registration, meet attendance and event results independent; never rewrite the source entry. */
export function effectiveObParticipation(event: string, entry?: Pick<ObEntry, "events" | "absent">, performance?: MeetPerformance) {
  const registered = !!entry?.events.includes(event);
  const absent = entry?.absent === true;
  const recorded = hasRecordedObPerformance(performance);
  const status: ObParticipationStatus = recorded ? performance!.status : !entry ? "missing" : absent ? "absent" : !registered ? "withdrawn" : performance?.status ?? "entered";
  const label = status === "entered" ? recorded ? "記録あり" : "出場" : status === "absent" ? "欠席" : status === "withdrawn" ? "登録取消" : status === "missing" ? "参加情報なし" : status === "DNS" ? "DNS（欠場）" : status;
  return { status, label, registered, absent, recorded, canParticipate: registered && !absent && (!performance || performance.status === "entered") };
}

/** Saved participants remain visible after a registration is removed, including their original results. */
export function obEventParticipants(event: string, entries: ObEntry[], saved?: MeetEventData) {
  const participants = [...(saved?.participants ?? [])];
  for (const entry of entries.filter(entry => entry.events.includes(event))) {
    if (!participants.some(person => person.entryId === entry.id)) participants.push(emptyPerformance(entry.id));
  }
  return participants.map(performance => {
    const entry = entries.find(entry => entry.id === performance.entryId);
    return { entryId: performance.entryId, entry, performance, state: effectiveObParticipation(event, entry, performance) };
  });
}
export function obEventRule(name: string): MeetEventRule {
  const base = name.replace(/^(男子|女子)/, "");
  return { name, discipline: base === "走り高跳び" ? "height" : ["100m", "300m", "300mH", "1500m", "3000m"].includes(base) ? "track" : "distance", wind: ["100m", "走り幅跳び"].includes(base) };
}

/** OB-specific roster adapter. Alumni are display-only and can never become duty candidates. */
export class ObMeetRoster {
  readonly rows;
  constructor(entries: ObEntry[], members: EntryMember[]) {
    this.rows = [
      ...dutyRows(entries, members).map(row => ({ ...row, alumni: false })),
      ...entries.filter(isAlumniEntry).sort((a, b) => a.submitted_name.localeCompare(b.submitted_name, "ja")).map(entry => ({ id: entry.id, name: entry.submitted_name, grade: entry.grade, entry, linked: false, alumni: true })),
    ];
  }
  static cell(entry: (Pick<ObEntry, "events"> & Partial<Pick<ObEntry, "id" | "absent">>) | undefined, slot: typeof OB_DUTY_SLOTS[number], operations: ObEventOperation[] = []) {
    const events = obDutyCompetitionEvents(entry, operations).filter(e => OB_DUTY_SLOTS.some(s => s.time === slot.time && s.events.includes(e.slice(2))));
    const own = events.filter(e => slot.events.includes(e.slice(2)));
    const dns = events.filter(event => operations.find(operation => operation.event_name === event)?.data.participants.find(person => person.entryId === entry?.id)?.status === "DNS");
    return { kind: entry?.absent ? "absent" as const : own.length ? "competing" as const : events.length ? "concurrent" as const : slot.note ? "on-day" as const : "empty" as const, events, own, dns };
  }
}

/** Preserve withdrawn people's saved performances; adding entrants must never silently delete results. */
export function reconcileObEvent(event: string, entries: ObEntry[], saved?: MeetEventData): MeetEventData {
  const rows = obEventParticipants(event, entries, saved);
  const participants = rows.map(row => row.performance);
  const changed = participants.length !== saved?.participants.length || rows.some(row => row.state.canParticipate && !row.state.recorded);
  return { participants, confirmed: !changed && (saved?.confirmed ?? false) };
}
