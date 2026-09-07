import { expect, it } from "vitest";
import {
  normalizeGoalDrafts,
  orderCompetitionEvents,
} from "./competition-goals";
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
it("prioritizes each block without hiding events or changing the system's order within it", () => {
  const events = [
    { name: "100m", sort_order: 10 },
    { name: "1500m", sort_order: 20 },
    { name: "5000m", sort_order: 30 },
    { name: "走幅跳", sort_order: 40 },
    { name: "自由種目", sort_order: 50 },
  ];
  expect(
    orderCompetitionEvents(events, "middle_long").map((e) => e.name),
  ).toEqual(["1500m", "5000m", "100m", "走幅跳", "自由種目"]);
  expect(orderCompetitionEvents(events, "short").map((e) => e.name)).toEqual([
    "100m",
    "走幅跳",
    "1500m",
    "5000m",
    "自由種目",
  ]);
  expect(orderCompetitionEvents(events, "standard")).toEqual(events);
  expect(events[0].name).toBe("100m");
});
