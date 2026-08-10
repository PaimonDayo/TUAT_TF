import { describe, expect, it } from "vitest";
import {
  buildItoGroups,
  createSeededRandom,
  itoGroupSizes,
  itoGroupingCost,
  itoPastPairCounts,
  validateItoGrouping,
} from "./ito-grouping";

const members = (count: number) =>
  Array.from({ length: count }, (_, i) => `p${String(i).padStart(2, "0")}`);

describe("ito grouping constraints", () => {
  it("accepts a normal camp-sized setup", () => {
    expect(
      validateItoGrouping({ participantCount: 48, groupCount: 10, maxGroupSize: 6 }),
    ).toEqual([]);
  });

  it("requires at least two groups", () => {
    const errors = validateItoGrouping({
      participantCount: 5,
      groupCount: 1,
      maxGroupSize: 5,
    });
    expect(errors.map((error) => error.code)).toContain("too_few_groups");
  });

  it("rejects a setup that cannot hold everyone", () => {
    const errors = validateItoGrouping({
      participantCount: 50,
      groupCount: 8,
      maxGroupSize: 6,
    });
    expect(errors.map((error) => error.code)).toEqual(["capacity_exceeded"]);
  });

  it("rejects a setup that would leave a group without a non-leader", () => {
    // 10グループに9人 → 1人だけの班ができる（代表者しかいない班は作らせない）
    const errors = validateItoGrouping({
      participantCount: 9,
      groupCount: 10,
      maxGroupSize: 5,
    });
    expect(errors.map((error) => error.code)).toContain("too_few_participants");

    // 4人・2グループが最小構成
    expect(
      validateItoGrouping({ participantCount: 4, groupCount: 2, maxGroupSize: 5 }),
    ).toEqual([]);
    expect(
      validateItoGrouping({ participantCount: 3, groupCount: 2, maxGroupSize: 5 }).map(
        (error) => error.code,
      ),
    ).toContain("too_few_participants");
  });

  it("allows leader-only groups when minGroupSize is 1 (solo mode)", () => {
    expect(
      validateItoGrouping({
        participantCount: 2,
        groupCount: 2,
        maxGroupSize: 5,
        minGroupSize: 1,
      }),
    ).toEqual([]);
  });
});

describe("ito group building", () => {
  it("splits everyone evenly without exceeding the maximum", () => {
    const sizes = itoGroupSizes(48, 10);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(48);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

    const groups = buildItoGroups({
      participantIds: members(48),
      groupCount: 10,
      maxGroupSize: 6,
      random: createSeededRandom(42),
    });
    expect(groups).toHaveLength(10);
    expect(groups.flat().sort()).toEqual(members(48).sort());
    for (const group of groups) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(group.length).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const options = { participantIds: members(20), groupCount: 4, maxGroupSize: 6 };
    const a = buildItoGroups({ ...options, random: createSeededRandom(7) });
    const b = buildItoGroups({ ...options, random: createSeededRandom(7) });
    const c = buildItoGroups({ ...options, random: createSeededRandom(8) });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("throws when the constraints cannot be satisfied", () => {
    expect(() =>
      buildItoGroups({ participantIds: members(3), groupCount: 2, maxGroupSize: 5 }),
    ).toThrow();
  });

  it("builds leader-only groups of size 1 when minGroupSize is 1 (solo mode)", () => {
    const groups = buildItoGroups({
      participantIds: members(4),
      groupCount: 4,
      maxGroupSize: 1,
      minGroupSize: 1,
      random: createSeededRandom(1),
    });
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      expect(group.length).toBe(1);
    }
    expect(groups.flat().sort()).toEqual(members(4).sort());
  });

  it("avoids putting past team-mates together again", () => {
    const participants = members(20);
    const first = buildItoGroups({
      participantIds: participants,
      groupCount: 4,
      maxGroupSize: 5,
      random: createSeededRandom(3),
    });

    const second = buildItoGroups({
      participantIds: participants,
      groupCount: 4,
      maxGroupSize: 5,
      history: [first],
      random: createSeededRandom(3),
    });

    const counts = itoPastPairCounts([first]);
    const naive = buildItoGroups({
      participantIds: participants,
      groupCount: 4,
      maxGroupSize: 5,
      random: createSeededRandom(3),
    });
    expect(itoGroupingCost(second, counts)).toBeLessThan(itoGroupingCost(naive, counts));
    expect(second.flat().sort()).toEqual(participants.sort());
  });
});
