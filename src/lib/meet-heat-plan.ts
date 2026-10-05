import type { MeetEventData } from "./meet-operations";

/** Checklist moves affect selected people; explicit slides reorder only editable slots. */
export class MeetHeatPlan {
  constructor(readonly data: MeetEventData, readonly eligibleIds: ReadonlySet<string>) {}
  get active() { return this.data.participants.filter(p => this.eligibleIds.has(p.entryId) && p.status === "entered"); }
  get unassigned() { return this.active.filter(p => p.group === null || p.order === null); }
  private selected(ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !this.active.some(p => p.entryId === id))) throw new Error("移す人を選んでください");
    return ids.map(id => this.active.find(p => p.entryId === id)!);
  }
  private result(positions: Map<string, {group: number | null; order: number | null}>): MeetEventData {
    const participants = this.data.participants.map(p => {
      const position = positions.get(p.entryId);
      return position && (p.group !== position.group || p.order !== position.order) ? {...p, ...position} : p;
    });
    if (participants.every((p,i) => p.group === this.data.participants[i].group && p.order === this.data.participants[i].order)) return this.data;
    return {...this.data, confirmed:false, participants};
  }
  private validCapacity(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 300) throw new Error("組の枠数を確認してください");
  }
  move(ids: string[], group: number | null, capacity?: number): MeetEventData {
    const selected = this.selected(ids);
    if (group === null) return this.result(new Map(ids.map(id => [id,{group:null,order:null}])));
    if (!Number.isInteger(group) || group < 1 || group > 99) throw new Error("これ以上組を作れません");
    if (capacity !== undefined) {
      this.validCapacity(capacity);
      const incoming = selected.filter(p => p.group !== group || p.order === null || p.order > capacity
        || this.data.participants.some(other => other.entryId !== p.entryId && other.group === group && other.order === p.order));
      const moving = new Set(incoming.map(p => p.entryId));
      // DNS, absence and cancelled entries keep their slots, even when hidden from the active roster.
      const reserved = new Set(this.data.participants.filter(p => p.group === group && !moving.has(p.entryId)).map(p => p.order));
      const available = Array.from({length:capacity}, (_, index) => index + 1).filter(order => !reserved.has(order));
      if (available.length < incoming.length) throw new Error(`この組の空き枠は${available.length}枠です。移す人を減らすか別の組を選んでください`);
      return this.result(new Map(incoming.map((p, index) => [p.entryId, {group,order:available[index]}])));
    }
    const incoming = selected.filter(p => p.group !== group || p.order === null);
    // DNS and cancelled entrants reserve their number for reinstatement.
    let order = Math.max(0,...this.data.participants.filter(p => p.group === group).map(p => p.order ?? 0));
    if (order + incoming.length > 300) throw new Error("この組の番号が300を超えています。新しい組へ移してください");
    return this.result(new Map(incoming.map(p => [p.entryId,{group,order:++order}])));
  }
  /** Original slot numbers in their new order, including blanks and excluding pinned inactive slots. */
  reorder(group: number, slotOrders: number[], capacity?: number): MeetEventData {
    if (!Number.isInteger(group) || group < 1 || group > 99) throw new Error("組を確認してください");
    if (capacity !== undefined) this.validCapacity(capacity);
    const placed = this.data.participants.filter(p => p.group === group && p.order !== null);
    const occupied = new Set<number>();
    for (const person of placed) {
      if (occupied.has(person.order!)) throw new Error("番号が重複しています。名前を選んで別の枠へ移してから並べ替えてください");
      occupied.add(person.order!);
    }
    const span = capacity ?? Math.max(1,...placed.map(p => p.order!),...slotOrders);
    this.validCapacity(span);
    const active = new Set(this.active.map(p => p.entryId));
    const pinned = new Set(placed.filter(p => !active.has(p.entryId)).map(p => p.order!));
    const editable = Array.from({length:span}, (_, index) => index + 1).filter(order => !pinned.has(order));
    if (slotOrders.length !== editable.length || new Set(slotOrders).size !== slotOrders.length || slotOrders.some(order => !editable.includes(order))) {
      throw new Error("並べ替える枠を確認してください");
    }
    const byOrder = new Map(placed.filter(p => p.order! <= span && active.has(p.entryId)).map(p => [p.order!, p]));
    const positions = new Map<string, {group: number; order: number}>();
    slotOrders.forEach((sourceOrder, index) => {
      const person = byOrder.get(sourceOrder);
      if (person) positions.set(person.entryId, {group,order:editable[index]});
    });
    return this.result(positions);
  }
  swap(ids: string[]): MeetEventData {
    if (ids.length !== 2) throw new Error("入れ替える2人を選んでください");
    const [a,b] = this.selected(ids);
    return this.result(new Map([[a.entryId,{group:b.group,order:b.order}],[b.entryId,{group:a.group,order:a.order}]]));
  }
  setDns(id: string, dns: boolean): MeetEventData {
    const person = this.data.participants.find(p => p.entryId === id);
    if (!person || !this.eligibleIds.has(id)) throw new Error("大会の欠席・出場登録を先に確認してください");
    if (dns && person.status !== "entered") throw new Error("記録画面で出場状況を確認してください");
    if (!dns && person.status !== "DNS") return this.data;
    if (!dns && person.group !== null && person.order !== null && this.data.participants.some(p => p.entryId !== id && p.status !== "DNS" && p.group === person.group && p.order === person.order)) {
      throw new Error(`${person.group}組${person.order}番を別の人が使用しています。その人を移してから出場に戻してください`);
    }
    return { ...this.data, confirmed: false, participants: this.data.participants.map(p => p.entryId === id ? { ...p, status: dns ? "DNS" : "entered" } : p) };
  }
}
