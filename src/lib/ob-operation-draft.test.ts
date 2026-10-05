import { expect, it } from "vitest";
import { emptyPerformance, type MeetEventData } from "./meet-operations";
import { obOperationSaveMatches, reviewObOperation } from "./ob-operation-draft";

const a = { ...emptyPerformance("a"), group: 1, order: 1 };
const b = { ...emptyPerformance("b"), group: 1, order: 2 };
const base: MeetEventData = { participants: [a, b], confirmed: false };
it("keeps a new entrant and independent saved results while moving another person", () => {
  const own = { ...base, participants: [{ ...a, group: 2 }, b] };
  const current = { ...base, participants: [{ ...a, trials: [{ status: "valid" as const, mark: "12.34", wind: "0" }] }, b, emptyPerformance("new")] };
  const result = reviewObOperation(base, own, current);
  expect(result.conflicts).toEqual([]);
  expect(result.data.participants[0]).toEqual({ ...current.participants[0], group: 2 });
  expect(result.data.participants[2].entryId).toBe("new");
});
it("requires an explicit position choice without overwriting a concurrently saved status", () => {
  const own = { ...base, participants: [{ ...a, group: 2 }, b] };
  const current = { ...base, participants: [{ ...a, group: 3, status: "DNS" as const }, b] };
  const review = reviewObOperation(base, own, current);
  expect(review.conflicts.map(c => c.key)).toEqual(["a:position"]);
  expect(reviewObOperation(base, own, current, { "a:position": "current" }).data.participants[0]).toEqual(current.participants[0]);
  expect(reviewObOperation(base, own, current, { "a:position": "own" }).data.participants[0]).toEqual({ ...current.participants[0], group: 2 });
});
it("does not treat equal edits as a conflict or drop unseen people", () => {
  const own = { ...base, participants: [{ ...a, status: "DNS" as const }, b] };
  expect(reviewObOperation(base, own, own).conflicts).toHaveLength(0);
  const current = { ...own, participants: [...own.participants, emptyPerformance("new")] };
  expect(reviewObOperation(base, own, current).data.participants).toHaveLength(3);
});
it("does not carry a concurrent confirmation onto unreviewed local edits", () => {
  const own = { ...base, participants: [{ ...a, group: 2 }, b] };
  const current = { ...base, confirmed: true };
  expect(reviewObOperation(base, own, current).data.confirmed).toBe(false);
  expect(reviewObOperation(base, base, current).data.confirmed).toBe(true);
  expect(reviewObOperation(base, { ...own, confirmed: true }, current).data.confirmed).toBe(true);
});

it("confirms the submitted mark while retaining unrelated marks, positions and new entrants", () => {
  const own = { ...base, participants: [{ ...a, trials: [{ mark: "12.34", status: "valid" as const, wind: "+0.5" }] }, b] };
  const current = { ...base, participants: [
    { ...own.participants[0], group: 2 },
    { ...b, trials: [{ mark: "13.45", status: "valid" as const, wind: "0" }] },
    { ...emptyPerformance("new"), group: 3, order: 1 },
  ] };
  const before = JSON.stringify([base, own, current]);
  expect(obOperationSaveMatches(base, own, current)).toBe(true);
  expect(JSON.stringify([base, own, current])).toBe(before);
  expect(obOperationSaveMatches(base, own, { ...current, participants: current.participants.map(person => person.entryId === "a" ? { ...person, trials: a.trials } : person) })).toBe(false);
});

it("checks each changed position, status and trial without accepting a different saved value", () => {
  const own = { ...base, participants: [{ ...a, group: 2, order: 3, status: "DNS" as const }, b] };
  expect(obOperationSaveMatches(base, own, own)).toBe(true);
  for (const changed of [{ ...own.participants[0], group: 3 }, { ...own.participants[0], order: 4 }, { ...own.participants[0], status: "entered" as const }]) {
    expect(obOperationSaveMatches(base, own, { ...own, participants: [changed, b] })).toBe(false);
  }
});

it("compares trial values regardless of JSON object key order, but preserves trial order and wind", () => {
  const own = { ...base, participants: [{ ...a, trials: [{ mark: "12.34", status: "valid" as const, wind: "+0.5" }] }, b] };
  const current = { ...own, participants: [{ ...a, trials: [{ wind: "+0.5", status: "valid" as const, mark: "12.34" }] }, b] };
  expect(obOperationSaveMatches(base, own, current)).toBe(true);
  expect(obOperationSaveMatches(base, own, { ...current, participants: [{ ...a, trials: [{ mark: "12.34", status: "valid", wind: "0" }] }, b] })).toBe(false);
});

it("requires a submitted new participant to exist without dropping later added participants", () => {
  const newPerson = { ...emptyPerformance("own-new"), group: 2, order: 1 };
  const own = { ...base, participants: [...base.participants, newPerson] };
  expect(obOperationSaveMatches(base, own, base)).toBe(false);
  expect(obOperationSaveMatches(base, own, { ...own, participants: [...own.participants, emptyPerformance("other-new")] })).toBe(true);
  expect(obOperationSaveMatches(base, own, { ...own, participants: [...base.participants, { ...newPerson, order: 2 }] })).toBe(false);
});

it("checks explicit confirmation changes while permitting an unrelated later confirmation", () => {
  expect(obOperationSaveMatches(base, { ...base, confirmed: true }, base)).toBe(false);
  expect(obOperationSaveMatches(base, { ...base, confirmed: true }, { ...base, confirmed: true })).toBe(true);
  expect(obOperationSaveMatches(base, base, { ...base, confirmed: true })).toBe(true);
  expect(obOperationSaveMatches({ ...base, confirmed: true }, base, { ...base, confirmed: true })).toBe(false);
});

it("does not confirm a missing participant or an unsupported removal from the submitted snapshot", () => {
  expect(obOperationSaveMatches(base, base, { ...base, participants: [a] })).toBe(false);
  expect(obOperationSaveMatches(base, { ...base, participants: [a] }, { ...base, participants: [a] })).toBe(false);
});
