import { expect, it } from "vitest";
import { normalizeGoalDrafts } from "./competition-goals";
it("keeps a separate target for every entered event", () => {
  expect(
    normalizeGoalDrafts([
      { event: "100m", target: " 11秒台 " },
      { event: "200m", target: "決勝進出" },
    ]),
  ).toEqual([
    { event: "100m", target: "11秒台" },
    { event: "200m", target: "決勝進出" },
  ]);
});
it("rejects duplicate events before sending a batch", () => {
  expect(() =>
    normalizeGoalDrafts([
      { event: "100m", target: "a" },
      { event: "100m ", target: "b" },
    ]),
  ).toThrow("重複");
});
it("rejects an incomplete batch without dropping any goal", () => {
  expect(() =>
    normalizeGoalDrafts([
      { event: "100m", target: "a" },
      { event: "200m", target: " " },
    ]),
  ).toThrow("入力");
});
