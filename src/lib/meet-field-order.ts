import type { MeetEventData, MeetPerformance, MeetOperationLimits } from "./meet-operations";

export type FieldOrderRow = { person: MeetPerformance; number: number | null };
const placed = (person: MeetPerformance) => person.group !== null && person.order !== null;

/** Display one trial order while retaining saved position pairs and incomplete placements. */
export function fieldOrderRows(data: MeetEventData): FieldOrderRow[] {
  const ordered = [...data.participants].sort((a, b) => {
    if (!placed(a) || !placed(b)) return Number(placed(b)) - Number(placed(a));
    // DNS may legally share a saved position; keep its anchor before the editable occupant.
    return a.group! - b.group! || a.order! - b.order! || Number(b.status === "DNS") - Number(a.status === "DNS");
  });
  let number = 0;
  return ordered.map(person => ({ person, number: placed(person) ? ++number : null }));
}

/** Explicit field slides reuse saved slots; fixed people and their results never move. */
export class MeetFieldPlan {
  constructor(readonly data: MeetEventData, readonly eligibleIds: ReadonlySet<string>, readonly limits: MeetOperationLimits = {}) {}

  private active(person: MeetPerformance) {
    return this.eligibleIds.has(person.entryId) && person.status === "entered";
  }

  get rows(): FieldOrderRow[] {
    return fieldOrderRows(this.data).filter(row => row.number !== null || this.active(row.person));
  }

  reorder(entryIds: string[]): MeetEventData {
    return this.applyOrder(entryIds, false);
  }

  /** Assign an already desired list, including a lone entrant, only after an explicit action. */
  assignOrder(): MeetEventData {
    return this.applyOrder(this.rows.filter(row => this.active(row.person)).map(row => row.person.entryId), true);
  }

  private applyOrder(entryIds: string[], assignUnplaced: boolean): MeetEventData {
    const rows = this.rows;
    const editable = rows.filter(row => this.active(row.person)).map(row => row.person);
    const expected = new Set(editable.map(person => person.entryId));
    if (this.data.participants.length > (this.limits.maxParticipants ?? 300) || new Set(this.data.participants.map(person => person.entryId)).size !== this.data.participants.length
      || entryIds.length !== editable.length || new Set(entryIds).size !== entryIds.length || entryIds.some(id => !expected.has(id))) {
      throw new Error("並べ替える出場者を確認してください");
    }
    // Opening, selection and an identity slide must not assign anyone or reopen confirmed results.
    if (entryIds.every((id, index) => id === editable[index].entryId) && (!assignUnplaced || editable.every(placed))) return this.data;

    const occupied = new Set<string>();
    for (const person of this.data.participants) {
      if (!(person.group === null || Number.isInteger(person.group) && person.group >= 1 && person.group <= (this.limits.maxGroups ?? 99))
        || !(person.order === null || Number.isInteger(person.order) && person.order >= 1 && person.order <= (this.limits.maxOrder ?? 300))) {
        throw new Error("保存されている試技順を確認してください");
      }
      if (placed(person) && person.status !== "DNS") {
        const position = `${person.group}:${person.order}`;
        if (occupied.has(position)) throw new Error("試技順が重複しています。保存されている試技順を確認してください");
        occupied.add(position);
      }
    }

    const saved = rows.filter(row => row.number !== null);
    const last = saved.at(-1)?.person;
    let group = last?.group ?? this.limits.defaultGroup ?? 1, order = last?.order ?? 0;
    const slots = editable.map(person => {
      if (placed(person)) return { group: person.group!, order: person.order! };
      if (order === (this.limits.maxOrder ?? 300)) { group++; order = 0; }
      if (group > (this.limits.maxGroups ?? 99)) throw new Error("試技順を追加できません。保存されている試技順を確認してください");
      return { group, order: ++order };
    });
    const positions = new Map(entryIds.map((id, index) => [id, slots[index]]));
    const participants = this.data.participants.map(person => {
      const position = positions.get(person.entryId);
      return position && (person.group !== position.group || person.order !== position.order) ? { ...person, ...position } : person;
    });
    if (participants.every((person, index) => person === this.data.participants[index])) return this.data;
    return { ...this.data, participants, confirmed: false };
  }
}
