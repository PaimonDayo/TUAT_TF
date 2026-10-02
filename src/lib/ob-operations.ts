import { isAlumniEntry, type ObEntry } from "./ob-entries";
import { dutyRows, OB_DUTY_SLOTS } from "./ob-meet";
import type { EntryMember } from "./entry-identity";
import { emptyPerformance, type MeetEventData, type MeetEventRule } from "./meet-operations";

export type ObEventOperation = { meet_key: string; event_name: string; revision: number; data: MeetEventData; updated_at: string };
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
  static cell(entry: Pick<ObEntry, "events"> | undefined, slot: typeof OB_DUTY_SLOTS[number]) {
    const events = entry?.events.filter(e => OB_DUTY_SLOTS.some(s => s.time === slot.time && s.events.includes(e.slice(2)))) ?? [];
    const own = events.filter(e => slot.events.includes(e.slice(2)));
    return { kind: own.length ? "competing" as const : events.length ? "concurrent" as const : slot.note ? "on-day" as const : "empty" as const, events, own };
  }
}

/** Preserve withdrawn people's saved performances; adding entrants must never silently delete results. */
export function reconcileObEvent(event: string, entries: ObEntry[], saved?: MeetEventData): MeetEventData {
  const participants = [...(saved?.participants ?? [])];
  for (const entry of entries.filter(e => e.events.includes(event))) if (!participants.some(p => p.entryId === entry.id)) participants.push(emptyPerformance(entry.id));
  const changed = participants.length !== saved?.participants.length || participants.some(p => !entries.some(e => e.id === p.entryId && e.events.includes(event)) && p.status !== "DNS");
  return { participants, confirmed: !changed && (saved?.confirmed ?? false) };
}
