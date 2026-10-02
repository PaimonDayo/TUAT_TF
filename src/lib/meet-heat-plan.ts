import type { MeetEventData, MeetPerformance } from "./meet-operations";

/** Immutable placement operations. Entry eligibility comes from the meet adapter. */
export class MeetHeatPlan {
  constructor(readonly data: MeetEventData, readonly eligibleIds: ReadonlySet<string>) {}

  get active() { return this.data.participants.filter(p => this.eligibleIds.has(p.entryId) && p.status !== "DNS"); }
  get unassigned() { return this.active.filter(p => p.group === null || p.order === null); }
  at(group: number, order: number) { return this.active.find(p => p.group === group && p.order === order); }

  private number(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error("組・人数・番号は1〜99で指定してください");
  }
  private selected(ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !this.active.some(p => p.entryId === id))) throw new Error("配置する出場者を選んでください");
    return ids.map(id => this.active.find(p => p.entryId === id)!);
  }
  private result(positions: Map<string, {group: number | null; order: number | null}>): MeetEventData {
    const participants = this.data.participants.map(p => positions.has(p.entryId) ? {...p, ...positions.get(p.entryId)!} : p);
    if (participants.every((p, i) => p.group === this.data.participants[i].group && p.order === this.data.participants[i].order)) return this.data;
    return {...this.data, confirmed: false, participants};
  }

  /** Move a selection together, preserving its displayed order. Fail atomically if full. */
  assign(ids: string[], group: number, capacity: number): MeetEventData {
    this.number(group); this.number(capacity); this.selected(ids);
    const occupied = new Set(this.data.participants.filter(p => !ids.includes(p.entryId) && p.status !== "DNS" && p.group === group).map(p => p.order));
    const free = Array.from({length: capacity}, (_, i) => i + 1).filter(order => !occupied.has(order));
    if (free.length < ids.length) throw new Error("この組の空きが足りません。人数を増やすか、別の組を選んでください");
    return this.result(new Map(ids.map((id, i) => [id, {group, order: free[i]}])));
  }

  /** An occupied destination exchanges places; an unassigned source releases its occupant. */
  place(id: string, group: number, order: number): MeetEventData {
    this.number(group); this.number(order);
    const [source] = this.selected([id]);
    const occupant = this.data.participants.find(p => p.status !== "DNS" && p.group === group && p.order === order && p.entryId !== id);
    if (occupant && !this.eligibleIds.has(occupant.entryId)) throw new Error("出場取消者の配置を先に外してください");
    const positions = new Map([[id, {group: group as number | null, order: order as number | null}]]);
    if (occupant) positions.set(occupant.entryId, source.group !== null && source.order !== null ? {group: source.group, order: source.order} : {group: null, order: null});
    return this.result(positions);
  }

  unassign(ids: string[]): MeetEventData {
    return this.result(new Map(ids.map(id => [id, {group: null, order: null}])));
  }

  /** Fill unassigned entrants only, in the adapter's roster order. */
  fill(capacity: number): MeetEventData {
    this.number(capacity);
    const used = new Set(this.data.participants.filter(p => p.status !== "DNS" && p.group !== null && p.order !== null).map(p => `${p.group}:${p.order}`));
    const positions = new Map<string, Pick<MeetPerformance, "group" | "order">>();
    for (const person of this.unassigned) {
      let found = false;
      for (let group = 1; group <= 99 && !found; group++) for (let order = 1; order <= capacity; order++) {
        const key = `${group}:${order}`;
        if (used.has(key)) continue;
        positions.set(person.entryId, {group, order}); used.add(key); found = true; break;
      }
      if (!found) throw new Error("配置できる枠がありません");
    }
    return this.result(positions);
  }
}
