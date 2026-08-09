import { describe, expect, it } from "vitest";
import {
  correctItoOrder,
  itoRanking,
  scoreItoOrder,
  scoreItoRound,
} from "./ito-score";

describe("ito scoring", () => {
  it("orders leaders from the largest secret number", () => {
    expect(
      correctItoOrder([
        { profileId: "b", number: 61 },
        { profileId: "a", number: 83 },
        { profileId: "c", number: 42 },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("counts leaders in the correct position (仕様15の例)", () => {
    const correct = ["A", "B", "C", "D", "E"];
    expect(scoreItoOrder(correct, ["A", "C", "B", "D", "E"])).toEqual({
      correctCount: 3,
      points: 3,
      isPerfect: false,
    });
  });

  it("doubles the score only on a perfect match", () => {
    const five = ["A", "B", "C", "D", "E"];
    expect(scoreItoOrder(five, five)).toEqual({
      correctCount: 5,
      points: 10,
      isPerfect: true,
    });

    const ten = Array.from({ length: 10 }, (_, i) => `L${i}`);
    expect(scoreItoOrder(ten, ten).points).toBe(20);
    expect(scoreItoOrder(ten, [...ten.slice(1), ten[0]]).points).toBe(0);
  });

  it("treats an unsubmitted or malformed order as zero", () => {
    const correct = ["A", "B", "C"];
    expect(scoreItoOrder(correct, [])).toEqual({
      correctCount: 0,
      points: 0,
      isPerfect: false,
    });
    expect(scoreItoOrder(correct, ["A", "B"]).points).toBe(0);
  });

  it("gives group points to non-leaders and leader-team points to leaders", () => {
    const result = scoreItoRound({
      secrets: [
        { profileId: "leaderA", number: 83 },
        { profileId: "leaderB", number: 61 },
        { profileId: "leaderC", number: 42 },
      ],
      groups: [
        {
          groupId: "A",
          isLeaderTeam: false,
          leaderId: "leaderA",
          memberIds: ["leaderA", "a1", "a2"],
          // 先頭だけ正位置 → 1点
          order: ["leaderA", "leaderC", "leaderB"],
        },
        {
          groupId: "B",
          isLeaderTeam: false,
          leaderId: "leaderB",
          memberIds: ["leaderB", "b1"],
          order: [],
        },
        {
          groupId: "C",
          isLeaderTeam: false,
          leaderId: "leaderC",
          memberIds: ["leaderC", "c1"],
          // 完全一致 → 3×2 = 6点
          order: ["leaderA", "leaderB", "leaderC"],
        },
        {
          groupId: "LEADERS",
          isLeaderTeam: true,
          leaderId: null,
          memberIds: [],
          // 1人だけ正位置 → 1点
          order: ["leaderB", "leaderA", "leaderC"],
        },
      ],
    });

    expect(result.correct).toEqual(["leaderA", "leaderB", "leaderC"]);
    expect(result.scores).toEqual([
      { groupId: "A", correctCount: 1, points: 1, isPerfect: false },
      { groupId: "B", correctCount: 0, points: 0, isPerfect: false },
      { groupId: "C", correctCount: 3, points: 6, isPerfect: true },
      { groupId: "LEADERS", correctCount: 1, points: 1, isPerfect: false },
    ]);

    // 代表者は自分の班の点を受け取らない。
    expect(result.points).toEqual([
      { profileId: "a1", points: 1, source: "group" },
      { profileId: "a2", points: 1, source: "group" },
      { profileId: "b1", points: 0, source: "group" },
      { profileId: "c1", points: 6, source: "group" },
      { profileId: "leaderA", points: 1, source: "leader_team" },
      { profileId: "leaderB", points: 1, source: "leader_team" },
      { profileId: "leaderC", points: 1, source: "leader_team" },
    ]);

    // 1ラウンドで1人が受け取るのは1件だけ。
    const ids = result.points.map((point) => point.profileId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accumulates points across rounds and shares ranks on a tie", () => {
    const ranking = itoRanking([
      { profileId: "yamada", points: 20 },
      { profileId: "yamada", points: 22 },
      { profileId: "sato", points: 42 },
      { profileId: "suzuki", points: 39 },
    ]);
    expect(ranking).toEqual([
      { profileId: "sato", total: 42, rank: 1 },
      { profileId: "yamada", total: 42, rank: 1 },
      { profileId: "suzuki", total: 39, rank: 3 },
    ]);
  });
});
