/** Framework/DB independent competition objects. Adapters supply entries and event rules. */
export type MeetDiscipline = "track" | "distance" | "height";
export type MeetHeatScope = "男子" | "女子" | "混合";
export type MeetOperationLimits = { maxParticipants?: number; maxGroups?: number; maxOrder?: number; defaultGroup?: number; groupLabel?: (group: number) => string };
export type MeetTrial = { mark: string; status: "pending" | "valid" | "foul" | "pass"; wind: string };
export type MeetPerformance = { entryId: string; group: number | null; order: number | null; heatScope?: MeetHeatScope; status: "entered" | "DNS" | "DNF" | "DQ"; trials: MeetTrial[] };
export type MeetEventData = { participants: MeetPerformance[]; confirmed: boolean };
export type MeetEventRule = { name: string; discipline: MeetDiscipline; wind: boolean };
export const emptyTrial = (): MeetTrial => ({ mark: "", status: "pending", wind: "" });
export const emptyPerformance = (entryId: string): MeetPerformance => ({ entryId, group: null, order: null, status: "entered", trials: [] });

/** Value object: numeric comparison never depends on formatted labels or floating point equality. */
export class MeetMark {
  static parse(text: string, discipline: MeetDiscipline): number | null {
    const value = text;
    if (discipline !== "track") return /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) > 0 ? Math.round(Number(value) * 100) : null;
    if (!/^\d{1,3}(:\d{1,2}){0,2}(\.\d{1,2})?$/.test(value)) return null;
    const parts = value.split(":").map(Number);
    if (parts.slice(1).some(n => n >= 60)) return null;
    const seconds = parts.reduce((sum, n) => sum * 60 + n, 0);
    return seconds > 0 ? Math.round(seconds * 100) : null;
  }
}

/** Event aggregate: validation, seeding and best marks are shared by UI and server actions. */
export class MeetEvent {
  constructor(readonly rule: MeetEventRule, readonly data: MeetEventData, readonly limits: MeetOperationLimits = {}) {}

  best(person: MeetPerformance): string {
    if (person.status !== "entered") return person.status;
    return this.bestTrial(person)?.mark ?? (person.trials.some(t => t.status === "foul") ? "記録なし" : "—");
  }

  /** The trial holding the best valid mark; equal marks keep the earlier attempt. */
  bestTrial(person: MeetPerformance): MeetTrial | undefined {
    const valid = person.trials.filter(t => t.status === "valid").map(t => ({ trial: t, value: MeetMark.parse(t.mark, this.rule.discipline) })).filter(t => t.value !== null);
    valid.sort((a, b) => this.rule.discipline === "track" ? a.value! - b.value! : b.value! - a.value!);
    return valid[0]?.trial;
  }

  validate(): string | null {
    const { participants, confirmed } = this.data;
    const maxParticipants = this.limits.maxParticipants ?? 300, maxGroups = this.limits.maxGroups ?? 99, maxOrder = this.limits.maxOrder ?? 300;
    if (!Array.isArray(participants) || participants.length > maxParticipants || typeof confirmed !== "boolean") return "出場者情報を確認してください";
    const ids = new Set<string>(), positions = new Set<string>();
    for (const p of participants) {
      if (!p || typeof p.entryId !== "string" || ids.has(p.entryId)) return "出場者が重複しています";
      ids.add(p.entryId);
      if (!(p.group === null || Number.isInteger(p.group) && p.group >= 1 && p.group <= maxGroups) || !(p.order === null || Number.isInteger(p.order) && p.order >= 1 && p.order <= maxOrder)) return `組は1〜${maxGroups}、順番は1〜${maxOrder}で入力してください`;
      if (p.heatScope !== undefined && !["男子", "女子", "混合"].includes(p.heatScope)) return "組の区分を確認してください";
      if (p.group !== null && p.order !== null && p.status !== "DNS") {
        const key = `${p.heatScope ?? this.rule.name.match(/^(男子|女子)/)?.[1] ?? ""}:${p.group}:${p.order}`;
        if (positions.has(key)) return "同じ組のレーン・試技順が重複しています";
        positions.add(key);
      }
      if (!["entered", "DNS", "DNF", "DQ"].includes(p.status) || !Array.isArray(p.trials) || p.trials.length > (this.rule.discipline === "track" ? 1 : this.rule.discipline === "height" ? 30 : 6)) return "試技数・出場状況を確認してください";
      for (const t of p.trials) {
        if (!t || typeof t.mark !== "string" || typeof t.wind !== "string" || !["pending", "valid", "foul", "pass"].includes(t.status)) return "試技を確認してください";
        if (this.rule.discipline === "track" && !["pending", "valid"].includes(t.status)) return "欠場・途中棄権・失格は出場状況で選んでください";
        if (t.status === "valid" && MeetMark.parse(t.mark, this.rule.discipline) === null) return this.rule.discipline === "track" ? "タイムを秒または分:秒で入力してください" : "記録をメートルで入力してください";
        if (t.status === "pending" && (t.mark || t.wind)) return "数値を入力した試技は結果を選んでください";
        if (t.mark && MeetMark.parse(t.mark, this.rule.discipline) === null) return "記録の数値を確認してください";
        if (t.status !== "valid" && this.rule.discipline !== "height" && t.mark) return "失敗・パスの記録欄は空にしてください";
        if (this.rule.discipline === "height" && t.status !== "pending" && !t.mark) return "試技した高さを入力してください";
        if (t.wind && (t.status !== "valid" || !this.rule.wind || !/^[+-]?\d{1,2}(\.\d)?$/.test(t.wind))) return "風速は符号付きの数値で入力してください";
      }
      if (confirmed && p.status === "entered" && !p.trials.some(t => t.status === "valid" || t.status === "foul")) return "未記録の出場者がいます。速報として保存してください";
    }
    return null;
  }

  /** Fill only unassigned people; do not erase deliberate placements or trial data. */
  seed(capacity: number): MeetEventData {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 99) throw new Error("組の人数は1〜99で指定してください");
    const used = new Set(this.data.participants.filter(p => p.group && p.order && p.status !== "DNS").map(p => `${p.group}:${p.order}`));
    return { ...this.data, confirmed: false, participants: this.data.participants.map(p => {
      if (p.status === "DNS" || p.group !== null || p.order !== null) return p;
      for (let group = 1; group <= 99; group++) for (let order = 1; order <= capacity; order++) {
        const key = `${group}:${order}`;
        if (!used.has(key)) { used.add(key); return { ...p, group, order }; }
      }
      throw new Error("配置できる枠がありません");
    }) };
  }
}
