import type { MeetEventData } from "./meet-operations";

/** Moving a person never repacks somebody else's number or erases a performance. */
export class MeetHeatPlan {
  constructor(readonly data: MeetEventData, readonly eligibleIds: ReadonlySet<string>) {}
  get active() { return this.data.participants.filter(p => this.eligibleIds.has(p.entryId) && p.status === "entered"); }
  get unassigned() { return this.active.filter(p => p.group === null || p.order === null); }
  private selected(ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !this.active.some(p => p.entryId === id))) throw new Error("移す人を選んでください");
    return ids.map(id => this.active.find(p => p.entryId === id)!);
  }
  private result(positions: Map<string, {group: number | null; order: number | null}>): MeetEventData {
    const participants = this.data.participants.map(p => positions.has(p.entryId) ? {...p, ...positions.get(p.entryId)!} : p);
    if (participants.every((p,i) => p.group === this.data.participants[i].group && p.order === this.data.participants[i].order)) return this.data;
    return {...this.data, confirmed:false, participants};
  }
  move(ids: string[], group: number | null): MeetEventData {
    const selected = this.selected(ids);
    if (group === null) return this.result(new Map(ids.map(id => [id,{group:null,order:null}])));
    if (!Number.isInteger(group) || group < 1 || group > 99) throw new Error("これ以上組を作れません");
    const incoming = selected.filter(p => p.group !== group || p.order === null);
    // DNS and cancelled entrants reserve their number for reinstatement.
    let order = Math.max(0,...this.data.participants.filter(p => p.group === group).map(p => p.order ?? 0));
    if (order + incoming.length > 300) throw new Error("この組の番号が300を超えています。新しい組へ移してください");
    return this.result(new Map(incoming.map(p => [p.entryId,{group,order:++order}])));
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
  /** First opening only; longer races and field events start together. */
  initial(separate: boolean): MeetEventData {
    if (this.data.participants.some(p => p.group !== null || p.order !== null || p.trials.length || p.status !== "entered") || this.data.confirmed) return this.data;
    return this.result(new Map(this.active.map((p,i) => [p.entryId,{group:separate?Math.floor(i/8)+1:1,order:separate?i%8+1:i+1}])));
  }
}
