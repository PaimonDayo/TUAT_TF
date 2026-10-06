import { expect, it } from "vitest";
import { emptyPerformance, MeetEvent, type MeetEventData, type MeetPerformance } from "./meet-operations";
import { MeetHeatPlan } from "./meet-heat-plan";
import { MeetFieldPlan } from "./meet-field-order";
import { obMixedFieldNumbers, obMixedGroup, obMixedGroupLabel, obMixedGroupPosition, obMixedLimits, nextMixedGroup, projectObMixedEvent, splitObMixedEvent } from "./ob-mixed-operations";
import type { ObEventOperation } from "./ob-operations";
import type { ObEntry } from "./ob-entries";

const male = "男子100m", female = "女子100m";
const entry = (id: string, events = [male]): ObEntry => ({ id, meet_key: "ob-2026", submitted_name: id, grade: "B1", events, qualification_marks: { [events[0]]: "12.34" }, profile_id: null, revision: 0, imported_at: "" });
const operation = (event: string, participants: MeetPerformance[], confirmed = true): ObEventOperation => ({ meet_key: "ob-2026", event_name: event, revision: 3, updated_at: "2026-10-06T00:00:00Z", data: { participants, confirmed } });
const placed = (id: string, group = 1, order = 1): MeetPerformance => ({ ...emptyPerformance(id), group, order, trials: [{ mark: "12.34", status: "valid", wind: "" }] });
const projection = () => projectObMixedEvent("100m", [entry("a"), entry("b", [female])], [operation(male, [placed("a")]), operation(female, [placed("b")])]);

it("projects two old first heats separately and round-trips without metadata, confirmation or record changes", () => {
  const a = placed("a"), b = placed("b"), saved = [operation(male, [a]), operation(female, [b])];
  const snapshot = JSON.stringify(saved);
  const view = projectObMixedEvent("100m", [entry("a"), entry("b", [female])], saved);
  expect(view.data.participants.map(p => [p.entryId, p.group, p.order, p.heatScope])).toEqual([[male + ":a", 1, 1, undefined], [female + ":b", 100, 1, undefined]]);
  expect(view.entrants.map(p => [p.division, p.sourceEvent, p.mark])).toEqual([["男子", male, "12.34"], ["女子", female, "12.34"]]);
  const split = splitObMixedEvent(view, view.data);
  expect(split[0].data.participants[0]).toBe(a); expect(split[1].data.participants[0]).toBe(b);
  expect(split[0].baseData).toBe(saved[0].data); expect(split[1].baseData).toBe(saved[1].data);
  expect(split.map(p => p.data.confirmed)).toEqual([true, true]);
  expect(JSON.stringify(saved)).toBe(snapshot);
});

it("moves a woman into an existing male heat without changing registration or the other source's records", () => {
  const view = projection(), ids = new Set(view.entrants.map(p => p.id));
  const next = new MeetHeatPlan(view.data, ids, obMixedLimits).move([female + ":b"], 1, 8);
  const split = splitObMixedEvent(view, next);
  expect(split[0].data).toBe(view.originalByEvent.get(male)!.data);
  expect(split[0].data.confirmed).toBe(true);
  expect(split[1].data.participants[0]).toEqual({ ...placed("b"), group: 1, order: 2, heatScope: "男子" });
  expect(split[1].data.confirmed).toBe(false);
  expect(split[1].data.participants[0].trials).toBe(view.sourceById.get(female + ":b")!.person.trials);
  const reopened = projectObMixedEvent("100m", [entry("a"), entry("b", [female])], split.map(p => operation(p.event, p.data.participants, p.data.confirmed)));
  expect(reopened.data.participants.map(p => p.group)).toEqual([1, 1]);
  expect(reopened.entrants.map(p => p.division)).toEqual(["男子", "女子"]);
});

it("reopens only a source with a newly registered blank row when explicitly saving another source's placement", () => {
  const a = placed("a"), b = placed("b");
  const saved = [operation(male, [a]), operation(female, [b])];
  const snapshot = JSON.stringify(saved);
  const view = projectObMixedEvent("100m", [entry("a"), entry("new"), entry("b", [female])], saved);
  expect(view.originalByEvent.get(male)!.baseData).toBe(saved[0].data);
  expect(view.data.participants.find(person => person.entryId === male + ":new")).toEqual(emptyPerformance(male + ":new"));
  const next = new MeetHeatPlan(view.data, new Set(view.entrants.map(person => person.id)), obMixedLimits).move([female + ":b"], 199, 8);
  const split = splitObMixedEvent(view, next);
  expect(split[0].data.confirmed).toBe(false);
  expect(split[0].data.participants[0]).toBe(a);
  expect(split[0].data.participants[1]).toEqual(emptyPerformance("new"));
  expect(split[0].baseData).toBe(saved[0].data);
  expect(split[0].revision).toBe(saved[0].revision);
  expect(split[1].data.confirmed).toBe(false);
  expect(split[1].data.participants[0].trials).toBe(b.trials);
  expect(JSON.stringify(saved)).toBe(snapshot);
});

it("moves both sexes into a new mixed heat and handles cross-source swaps without overwriting trials", () => {
  const view = projection(), ids = new Set(view.entrants.map(p => p.id));
  const moved = new MeetHeatPlan(view.data, ids, obMixedLimits).move([...ids], 199, 8);
  const split = splitObMixedEvent(view, moved);
  expect(split.flatMap(p => p.data.participants).map(p => [p.group, p.order, p.heatScope])).toEqual([[1, 1, "混合"], [1, 2, "混合"]]);
  expect(split.map(p => p.data.confirmed)).toEqual([false, false]);
  const swapped = splitObMixedEvent(view, new MeetHeatPlan(view.data, ids, obMixedLimits).swap([...ids]));
  expect(swapped.flatMap(p => p.data.participants).map(p => [p.group, p.order, p.heatScope])).toEqual([[1, 1, "女子"], [1, 1, "男子"]]);
});

it("preserves historical appearances for the same entry in both source events and keeps their badges independent", () => {
  const old = placed("same"), current = { ...placed("same"), trials: [{ mark: "13.45", status: "valid" as const, wind: "" }] };
  const view = projectObMixedEvent("100m", [entry("same", [female])], [operation(male, [old]), operation(female, [current])]);
  expect(view.data.participants).toHaveLength(2);
  expect(view.entrants.map(p => [p.id, p.division, p.eligible])).toEqual([[male + ":same", "男子", false], [female + ":same", "女子", true]]);
  const split = splitObMixedEvent(view, view.data);
  expect(split[0].data.participants[0]).toBe(old); expect(split[1].data.participants[0]).toBe(current);
  expect(view.sourceById.get(male + ":same")).toMatchObject({ event: male, entryId: "same", division: "男子" });
});

it("pins DNS, absent, withdrawn and missing historical people across sexes", () => {
  const a = placed("a"), dns = { ...placed("dns", 2), status: "DNS" as const }, absent = placed("absent", 3), old = placed("old", 4), missing = placed("missing", 5);
  const view = projectObMixedEvent("100m", [entry("a"), entry("dns", [female]), { ...entry("absent", [female]), absent: true }, entry("old", [])], [operation(male, [a]), operation(female, [dns, absent, old, missing])]);
  const eligible = new Set(view.entrants.filter(p => p.eligible && !p.absent).map(p => p.id));
  const next = new MeetHeatPlan(view.data, eligible, obMixedLimits).move([male + ":a"], 199, 8);
  const split = splitObMixedEvent(view, next);
  expect(split[1].data.participants).toEqual([dns, absent, old, missing]);
  split[1].data.participants.forEach((p, i) => expect(p).toBe([dns, absent, old, missing][i]));
  expect(split[1].data.confirmed).toBe(true);
  expect(view.entrants.find(p => p.id === female + ":missing")?.division).toBe("女子");
});

it("supports 300 registrations per sex and an explicit 600-person combined field order", () => {
  const family = "走り幅跳び", men = "男子" + family, women = "女子" + family;
  const entries = [men, women].flatMap(event => Array.from({ length: 300 }, (_, i) => entry(event + i, [event])));
  const view = projectObMixedEvent(family, entries, []);
  expect(view.data.participants).toHaveLength(600);
  expect(view.data.participants.every(p => p.group === null && p.order === null)).toBe(true);
  const plan = new MeetFieldPlan(view.data, new Set(view.entrants.map(p => p.id)), obMixedLimits);
  expect(plan.reorder(view.data.participants.map(p => p.entryId))).toBe(view.data);
  const next = plan.assignOrder(), split = splitObMixedEvent(view, next);
  expect(new Set(next.participants.map(p => p.group))).toEqual(new Set([199]));
  expect(next.participants.at(-1)?.order).toBe(600);
  expect(split.map(p => p.data.participants.length)).toEqual([300, 300]);
  expect(split.every(p => p.data.participants.every(person => person.group === 1 && person.heatScope === "混合"))).toBe(true);
  split.forEach(p => expect(new MeetEvent({ name: p.event, discipline: "distance", wind: true }, p.data, { maxOrder: 600 }).validate()).toBeNull());
  expect(obMixedFieldNumbers({ data: next }).get(women + ":" + women + 299)).toBe(600);
});

it("gives field legacy orders distinct source slots until an explicit shared reorder", () => {
  const view = projection();
  expect([...obMixedFieldNumbers(view).values()]).toEqual([1, 2]);
  const plan = new MeetFieldPlan(view.data, new Set(view.entrants.map(p => p.id)), obMixedLimits);
  const next = plan.reorder([female + ":b", male + ":a"]);
  expect(splitObMixedEvent(view, next).flatMap(p => p.data.participants).map(p => p.heatScope)).toEqual(["女子", "男子"]);
});

it("keeps scopes and confirmation unchanged for a status/trial edit and a semantic no-op", () => {
  const p = { ...placed("a"), heatScope: "混合" as const };
  const view = projectObMixedEvent("100m", [entry("a")], [operation(male, [p])]);
  const row = view.data.participants[0];
  const typedThenCleared: MeetEventData = { ...view.data, participants: [{ ...row, trials: [...row.trials, { mark: "", wind: "", status: "pending" }] }] };
  expect(splitObMixedEvent(view, typedThenCleared)[0].data.participants[0]).toBe(p);
  const next = { ...view.data, participants: [{ ...row, status: "DNS" as const }] };
  expect(splitObMixedEvent(view, next)[0].data.participants[0]).toEqual({ ...p, status: "DNS" });
});

it("finds mixed empty frames without confusing same-number old heats, and rejects invalid group codes", () => {
  expect([1, 99, 100, 198, 199, 297].map(obMixedGroupLabel)).toEqual(["男子1組", "男子99組", "女子1組", "女子99組", "混合1組", "混合99組"]);
  expect(obMixedGroup(male, placed("a"))).toBe(1);
  expect(obMixedGroup(female, { ...placed("b"), heatScope: "男子" })).toBe(1);
  expect(obMixedGroupPosition(297)).toEqual({ group: 99, heatScope: "混合" });
  expect(nextMixedGroup([1, 100, 199, 201, 297])).toBe(200);
  expect(nextMixedGroup(Array.from({ length: 99 }, (_, i) => 199 + i))).toBeNull();
  for (const invalid of [0, 298, 1.5]) expect(() => obMixedGroupLabel(invalid)).toThrow();
});

it("refuses roster loss or invented composite identities and preserves every source snapshot", () => {
  const view = projection(), snapshot = JSON.stringify(view.data);
  for (const participants of [view.data.participants.slice(1), [view.data.participants[0], view.data.participants[0]], [{ ...view.data.participants[0], entryId: "unknown" }, view.data.participants[1]]]) {
    expect(() => splitObMixedEvent(view, { ...view.data, participants })).toThrow("出場者");
  }
  expect(JSON.stringify(view.data)).toBe(snapshot);
});
