import { describe, expect, it } from "vitest";
import { MeetFieldPlan, fieldOrderRows } from "./meet-field-order";
import { MeetEvent, emptyPerformance, type MeetEventData, type MeetPerformance } from "./meet-operations";
import { obOperationHasChanges } from "./ob-operation-draft";

const person = (entryId: string, group: number | null = null, order: number | null = null): MeetPerformance => ({ ...emptyPerformance(entryId), group, order });
const data = (participants: MeetPerformance[], confirmed = true): MeetEventData => ({ participants, confirmed });
const eligible = (...ids: string[]) => new Set(ids);
const positions = (value: MeetEventData) => Object.fromEntries(value.participants.map(p => [p.entryId, [p.group, p.order]]));
const trial = { mark: "6.10", status: "valid" as const, wind: "+1.2" };

describe("field trial order projection", () => {
  it("flattens saved groups and gaps without changing the source, and retains every incomplete row", () => {
    const source = data([person("new"), person("b", 3, 9), person("a", 1, 7), person("group-only", 2), person("order-only", null, 4)]);
    const snapshot = JSON.stringify(source);
    expect(fieldOrderRows(source).map(row => [row.person.entryId, row.number])).toEqual([["a", 1], ["b", 2], ["new", null], ["group-only", null], ["order-only", null]]);
    expect(fieldOrderRows(source).every(row => source.participants.includes(row.person))).toBe(true);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("keeps shared-position DNS anchors first with stable ties and never loses duplicates", () => {
    const source = data([person("a", 2, 1), { ...person("dns-a", 2, 1), status: "DNS" }, { ...person("dns-b", 2, 1), status: "DNS" }, person("b", 3, 1)]);
    expect(fieldOrderRows(source).map(row => [row.person.entryId, row.number])).toEqual([["dns-a", 1], ["dns-b", 2], ["a", 3], ["b", 4]]);
    const next = new MeetFieldPlan(source, eligible("a", "b")).reorder(["b", "a"]);
    expect(fieldOrderRows(next).map(row => [row.person.entryId, row.number])).toEqual([["dns-a", 1], ["dns-b", 2], ["b", 3], ["a", 4]]);
    expect(next.participants[1]).toBe(source.participants[1]);
    expect(next.participants[2]).toBe(source.participants[2]);
    expect(new MeetEvent({ name: "走り幅跳び", discipline: "distance", wind: true }, next).validate()).toBeNull();
  });
});

describe("explicit field trial order changes", () => {
  it("leaves fresh entrants and confirmation unchanged on opening or an identity slide", () => {
    const source = data(Array.from({ length: 12 }, (_, index) => person(`p${index}`)));
    const plan = new MeetFieldPlan(source, new Set(source.participants.map(p => p.entryId)));
    expect(plan.rows.map(row => row.number)).toEqual(Array(12).fill(null));
    expect(plan.reorder(source.participants.map(p => p.entryId))).toBe(source);
    expect(source.participants.every(p => p.group === null && p.order === null)).toBe(true);
    expect(source.confirmed).toBe(true);
  });

  it("assigns one explicit fresh sequence, retains array identity order and results, and repeats as a no-op", () => {
    const a = { ...person("a"), trials: [trial] }, b = person("b"), c = person("c");
    const source = data([a, b, c]);
    const next = new MeetFieldPlan(source, eligible("a", "b", "c")).reorder(["c", "a", "b"]);
    expect(positions(next)).toEqual({ a: [1, 2], b: [1, 3], c: [1, 1] });
    expect(next.participants.map(p => p.entryId)).toEqual(["a", "b", "c"]);
    expect(next.participants[0].trials).toBe(a.trials);
    expect(source.participants).toEqual([a, b, c]);
    expect(next.confirmed).toBe(false);
    expect(new MeetFieldPlan(next, eligible("a", "b", "c")).reorder(["c", "a", "b"])).toBe(next);
    expect(new MeetEvent({ name: "走り幅跳び", discipline: "distance", wind: true }, next).validate()).toBeNull();
  });

  it("lets a lone fresh entrant be explicitly assigned without changing anything on opening or undo", () => {
    const a = { ...person("a"), trials: [trial] };
    const source = data([a]);
    const plan = new MeetFieldPlan(source, eligible("a"));
    expect(plan.rows).toEqual([{ person: a, number: null }]);
    expect(plan.reorder(["a"])).toBe(source);
    expect(obOperationHasChanges(source, source)).toBe(false);
    const next = plan.assignOrder();
    expect(next.participants).toEqual([{ ...a, group: 1, order: 1 }]);
    expect(next.participants[0].trials).toBe(a.trials);
    expect(next.confirmed).toBe(false);
    expect(obOperationHasChanges(source, next)).toBe(true);
    // The previous snapshot remains the unchanged value restored by the board's undo.
    expect(source).toEqual(data([a]));
    expect(obOperationHasChanges(source, source)).toBe(false);
    expect(new MeetFieldPlan(next, eligible("a")).assignOrder()).toBe(next);
  });

  it("explicitly sets the current fresh list without a fake slide and preserves saved inactive anchors", () => {
    const a = person("a", 1, 3), dns = { ...person("dns", 4, 12), status: "DNS" as const }, absent = person("absent", 5, 15), b = person("b"), c = person("c");
    const source = data([a, dns, absent, b, c]);
    const plan = new MeetFieldPlan(source, eligible("a", "b", "c", "dns"));
    expect(plan.reorder(["a", "b", "c"])).toBe(source);
    const next = plan.assignOrder();
    expect(positions(next)).toEqual({ a: [1, 3], dns: [4, 12], absent: [5, 15], b: [5, 16], c: [5, 17] });
    expect(next.participants[0]).toBe(a);
    expect(next.participants[1]).toBe(dns);
    expect(next.participants[2]).toBe(absent);
    expect(fieldOrderRows(next).map(row => row.person.entryId)).toEqual(["a", "dns", "absent", "b", "c"]);
    expect(new MeetFieldPlan(next, eligible("a", "b", "c", "dns")).assignOrder()).toBe(next);
  });

  it("keeps a fully placed confirmed event and an inactive-only event unchanged on explicit assignment", () => {
    const saved = data([person("a", 3, 8), person("b", 5, 11)]);
    expect(new MeetFieldPlan(saved, eligible("a", "b")).assignOrder()).toBe(saved);
    expect(saved.confirmed).toBe(true);
    const inactive = data([person("absent"), { ...person("dns"), status: "DNS" }]);
    expect(new MeetFieldPlan(inactive, eligible("dns")).assignOrder()).toBe(inactive);
    expect(inactive.participants.every(p => p.group === null && p.order === null)).toBe(true);
  });

  it("slides across legacy groups while preserving DNS, absent, cancelled and recorded inactive anchors", () => {
    const a = { ...person("a", 1, 4), trials: [trial] }, b = person("b", 7, 15);
    const pins = [{ ...person("dns", 1, 5), status: "DNS" as const }, person("absent", 2, 8), person("cancelled", 3, 12), { ...person("dnf", 4, 1), status: "DNF" as const, trials: [trial] }, { ...person("dq", 6, 9), status: "DQ" as const }];
    const source = data([a, ...pins, b]);
    const next = new MeetFieldPlan(source, eligible("a", "b", "dns", "dnf", "dq")).reorder(["b", "a"]);
    expect(positions(next)).toEqual({ a: [7, 15], dns: [1, 5], absent: [2, 8], cancelled: [3, 12], dnf: [4, 1], dq: [6, 9], b: [1, 4] });
    pins.forEach((pin, index) => expect(next.participants[index + 1]).toBe(pin));
    expect(next.participants[0].trials).toBe(a.trials);
    expect(fieldOrderRows(next).map(row => row.person.entryId)).toEqual(["b", "dns", "absent", "cancelled", "dnf", "dq", "a"]);
    expect(next.confirmed).toBe(false);
  });

  it("keeps newly registered people unassigned until an actual slide and fills them after all saved anchors", () => {
    const a = person("a", 1, 2), pin = person("absent", 8, 4), b = person("b"), c = person("c", 5);
    const source = data([a, pin, b, c]);
    const plan = new MeetFieldPlan(source, eligible("a", "b", "c"));
    expect(plan.reorder(["a", "b", "c"])).toBe(source);
    const next = plan.reorder(["b", "a", "c"]);
    expect(positions(next)).toEqual({ a: [8, 5], absent: [8, 4], b: [1, 2], c: [8, 6] });
    expect(next.participants[1]).toBe(pin);
    expect(fieldOrderRows(next).map(row => [row.person.entryId, row.number])).toEqual([["b", 1], ["absent", 2], ["a", 3], ["c", 4]]);
  });

  it("retains unplaced inactive and partial positions outside the sortable rows without assigning them", () => {
    const pins = [{ ...person("dns"), status: "DNS" as const }, person("absent", 9), person("cancelled", null, 3)];
    const source = data([person("a"), ...pins, person("b")]);
    const plan = new MeetFieldPlan(source, eligible("a", "b", "dns"));
    expect(plan.rows.map(row => row.person.entryId)).toEqual(["a", "b"]);
    const next = plan.reorder(["b", "a"]);
    pins.forEach((pin, index) => expect(next.participants[index + 1]).toBe(pin));
    expect(fieldOrderRows(next).map(row => row.person.entryId)).toEqual(["b", "a", "dns", "absent", "cancelled"]);
  });

  it("supports all 300 entrants and carries a saved order300 into the next group internally", () => {
    const crowd = Array.from({ length: 300 }, (_, index) => person(`p${index}`));
    const source = data(crowd);
    const ids = crowd.map(p => p.entryId).reverse();
    const next = new MeetFieldPlan(source, new Set(ids)).reorder(ids);
    expect(positions(next).p0).toEqual([1, 300]);
    expect(positions(next).p299).toEqual([1, 1]);
    expect(new MeetEvent({ name: "走り高跳び", discipline: "height", wind: false }, { ...next, confirmed: false }).validate()).toBeNull();
    const legacy = data([person("a", 7, 299), person("b"), person("c")]);
    const rolled = new MeetFieldPlan(legacy, eligible("a", "b", "c")).reorder(["b", "c", "a"]);
    expect(positions(rolled)).toEqual({ a: [8, 1], b: [7, 299], c: [7, 300] });
    expect(fieldOrderRows(rolled).map(row => row.number)).toEqual([1, 2, 3]);
  });

  it("refuses exhausted virtual positions atomically but allows identity and existing-slot changes", () => {
    const source = data([person("a", 99, 300), person("b")]);
    const plan = new MeetFieldPlan(source, eligible("a", "b"));
    expect(plan.reorder(["a", "b"])).toBe(source);
    expect(() => plan.reorder(["b", "a"])).toThrow("試技順を追加できません");
    expect(positions(source)).toEqual({ a: [99, 300], b: [null, null] });
    expect(source.confirmed).toBe(true);
    const saved = data([person("a", 99, 299), person("b", 99, 300)]);
    expect(positions(new MeetFieldPlan(saved, eligible("a", "b")).reorder(["b", "a"]))).toEqual({ a: [99, 300], b: [99, 299] });
  });

  it.each([["a"], ["b", "b"], ["b", "unknown"], ["b", "dns"], ["b", "a", "extra"]].map(ids => ({ ids })))("rejects incomplete, repeated or inactive permutations $ids atomically", ({ ids }) => {
    const source = data([person("a", 1, 1), person("b", 2, 1), { ...person("dns", 1, 2), status: "DNS" }]);
    const snapshot = JSON.stringify(source);
    expect(() => new MeetFieldPlan(source, eligible("a", "b", "dns")).reorder(ids)).toThrow("出場者");
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("checks the current eligible roster before applying a stale permutation", () => {
    const source = data([person("a", 1, 1), person("b", 1, 2), person("c")]);
    expect(() => new MeetFieldPlan(source, eligible("a", "c")).reorder(["c", "b", "a"])).toThrow("出場者");
    expect(new MeetFieldPlan(source, eligible()).reorder([])).toBe(source);
  });

  it("refuses non-DNS duplicate positions and invalid legacy values without dropping rows", () => {
    const duplicate = data([person("a", 1, 1), person("b", 1, 1)]);
    expect(fieldOrderRows(duplicate)).toHaveLength(2);
    expect(() => new MeetFieldPlan(duplicate, eligible("a", "b")).reorder(["b", "a"])).toThrow("重複");
    for (const invalid of [person("a", 100, 1), person("a", 1, 301), person("a", 1.5, 1), person("a", null, 0)]) {
      const source = data([invalid, person("b")]);
      expect(() => new MeetFieldPlan(source, eligible("a", "b")).reorder(["b", "a"])).toThrow("保存されている試技順");
      expect(source.participants[0]).toBe(invalid);
    }
    const repeated = data([person("a"), person("a")]);
    expect(() => new MeetFieldPlan(repeated, eligible("a")).reorder(["a", "a"])).toThrow("出場者");
  });
});
