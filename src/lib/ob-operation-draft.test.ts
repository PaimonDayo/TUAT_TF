import { expect, it } from "vitest";
import { emptyPerformance, type MeetEventData } from "./meet-operations";
import { reviewObOperation } from "./ob-operation-draft";

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
