import { fieldOrderRows } from "./meet-field-order";
import type { MeetEventData, MeetPerformance, MeetHeatScope, MeetOperationLimits } from "./meet-operations";
import { obOperationHasChanges } from "./ob-operation-draft";
import { effectiveObParticipation, obEventParticipants, obEventRule, type ObEventOperation } from "./ob-operations";
import { isAlumniEntry, type ObEntry } from "./ob-entries";

export type ObDivision = "男子" | "女子";
export type ObMixedSource = { event: string; entryId: string; division: ObDivision; person: MeetPerformance };
export type ObMixedEntrant = { id: string; name: string; grade: string; mark: string; alumni: boolean; eligible: boolean; absent: boolean; division: ObDivision; sourceEvent: string };
export type ObMixedInput = { event: string; data: MeetEventData; baseData: MeetEventData; revision: number | null };
export type ObMixedProjection = {
  family: string; data: MeetEventData; entrants: ObMixedEntrant[];
  sourceById: Map<string, ObMixedSource>; originalByEvent: Map<string, ObMixedInput>;
};
const scopes: MeetHeatScope[] = ["男子", "女子", "混合"];
export const obMixedLimits: MeetOperationLimits = { maxParticipants: 600, maxGroups: 297, maxOrder: 600, defaultGroup: 199, groupLabel: obMixedGroupLabel };

export function obSourceDivision(event: string): ObDivision {
  if (event.startsWith("男子")) return "男子";
  if (event.startsWith("女子")) return "女子";
  throw new Error("出場種目の区分を確認してください");
}
export function obSourceEvent(family: string, division: ObDivision): string {
  return division + family.replace(/^(男子|女子)/, "");
}
export function obMixedGroup(event: string, person: Pick<MeetPerformance, "group" | "heatScope">): number | null {
  if (person.group === null) return null;
  const scope = person.heatScope ?? obSourceDivision(event);
  const index = scopes.indexOf(scope);
  if (index < 0 || !Number.isInteger(person.group) || person.group < 1 || person.group > 99) throw new Error("保存されている組を確認してください");
  return index * 99 + person.group;
}
export function obMixedGroupPosition(group: number): { group: number; heatScope: MeetHeatScope } {
  if (!Number.isInteger(group) || group < 1 || group > 297) throw new Error("移動先の組を確認してください");
  return { group: (group - 1) % 99 + 1, heatScope: scopes[Math.floor((group - 1) / 99)] };
}
export function obMixedGroupLabel(group: number): string {
  const position = obMixedGroupPosition(group);
  return `${position.heatScope}${position.group}組`;
}
export function nextMixedGroup(groups: Iterable<number>): number | null {
  const used = new Set(groups);
  for (let group = 199; group <= 297; group++) if (!used.has(group)) return group;
  return null;
}

/** Composite identities keep historical appearances in both source divisions visible. */
export function projectObMixedEvent(family: string, entries: ObEntry[], operations: ObEventOperation[]): ObMixedProjection {
  family = family.replace(/^(男子|女子)/, "");
  const participants: MeetPerformance[] = [], entrants: ObMixedEntrant[] = [];
  const sourceById = new Map<string, ObMixedSource>(), originalByEvent = new Map<string, ObMixedInput>();
  for (const division of ["男子", "女子"] as const) {
    const event = obSourceEvent(family, division);
    const saved = operations.filter(operation => operation.event_name === event && operation.meet_key === "ob-2026")
      .reduce<ObEventOperation | undefined>((latest, operation) => !latest || latest.revision < operation.revision ? operation : latest, undefined);
    const baseData = saved?.data ?? { participants: [], confirmed: false };
    const rows = obEventParticipants(event, entries, saved?.data);
    originalByEvent.set(event, { event, data: { participants: rows.map(row => row.performance), confirmed: baseData.confirmed }, baseData, revision: saved?.revision ?? null });
    for (const row of rows) {
      const id = `${event}:${row.entryId}`;
      if (sourceById.has(id)) throw new Error("出場者が重複しています");
      const person = { ...row.performance };
      delete person.heatScope;
      participants.push({ ...person, entryId: id, group: obMixedGroup(event, row.performance) });
      sourceById.set(id, { event, entryId: row.entryId, division, person: row.performance });
      entrants.push({ id, name: row.entry?.submitted_name ?? "登録解除済み", grade: row.entry?.grade ?? "", mark: row.entry?.qualification_marks[event] ?? "", alumni: !!row.entry && isAlumniEntry(row.entry), eligible: !!row.entry?.events.includes(event), absent: row.entry?.absent ?? false, division, sourceEvent: event });
    }
  }
  const populated = [...originalByEvent.values()].filter(value => value.data.participants.length || value.revision !== null);
  return { family, data: { participants, confirmed: populated.length > 0 && populated.every(value => value.data.confirmed) }, entrants, sourceById, originalByEvent };
}

/** Split explicit edits without adding metadata or replacing unchanged raw participant objects. */
export function splitObMixedEvent(projection: ObMixedProjection, next: MeetEventData): ObMixedInput[] {
  const before = new Map(projection.data.participants.map(person => [person.entryId, person]));
  if (next.participants.length !== before.size || new Set(next.participants.map(person => person.entryId)).size !== next.participants.length
    || next.participants.some(person => !before.has(person.entryId))) throw new Error("並べ替える出場者を確認してください");
  const byEvent = new Map<string, Map<string, MeetPerformance>>();
  for (const person of next.participants) {
    const source = projection.sourceById.get(person.entryId)!;
    const original = before.get(person.entryId)!;
    let restored = source.person;
    if (obOperationHasChanges({ participants: [original], confirmed: false }, { participants: [person], confirmed: false })) {
      restored = { ...source.person, status: person.status, trials: person.trials };
      if (person.group !== original.group || person.order !== original.order) {
        restored.group = person.group === null ? null : obMixedGroupPosition(person.group).group;
        restored.order = person.order;
        if (person.group === null) delete restored.heatScope;
        else {
          const scope = obMixedGroupPosition(person.group).heatScope;
          if (scope === source.division && source.person.heatScope === undefined) delete restored.heatScope;
          else restored.heatScope = scope;
        }
      }
    }
    if (!byEvent.has(source.event)) byEvent.set(source.event, new Map());
    byEvent.get(source.event)!.set(source.entryId, restored);
  }
  return [...projection.originalByEvent.values()].map(original => {
    const people = byEvent.get(original.event);
    const participants = original.data.participants.map(person => people?.get(person.entryId) ?? person);
    const changed = participants.some((person, index) => person !== original.data.participants[index]);
    const savedIds = new Set(original.baseData.participants.map(person => person.entryId));
    const added = participants.some(person => !savedIds.has(person.entryId));
    return { ...original, data: changed || added ? { participants, confirmed: false } : original.data };
  });
}

export function obMixedFieldNumbers(projection: Pick<ObMixedProjection, "data">): Map<string, number | null> {
  return new Map(fieldOrderRows(projection.data).map(row => [row.person.entryId, row.number]));
}

/** One event's whole start list in program order, including withdrawals and already recorded results. */
export function obFamilyRows(family: string, entries: ObEntry[], operations: ObEventOperation[]) {
  const field = obEventRule(family).discipline !== "track";
  const projection = projectObMixedEvent(family, entries, operations);
  const numbers = field ? obMixedFieldNumbers(projection) : new Map<string, number | null>();
  return [...projection.data.participants].sort((a, b) => field
    ? (numbers.get(a.entryId) ?? 601) - (numbers.get(b.entryId) ?? 601)
    : (a.group ?? 298) - (b.group ?? 298) || (a.order ?? 601) - (b.order ?? 601) || Number(b.status === "DNS") - Number(a.status === "DNS"))
    .map(person => {
      const source = projection.sourceById.get(person.entryId)!;
      const entry = entries.find(entry => entry.id === source.entryId);
      const saved = operations.find(operation => operation.event_name === source.event);
      return { id: person.entryId, entryId: source.entryId, entry, performance: source.person, state: effectiveObParticipation(source.event, entry, source.person), division: source.division, eventName: source.event, saved, group: person.group, number: numbers.get(person.entryId) ?? null };
    });
}
