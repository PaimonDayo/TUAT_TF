import { describe, expect, it } from "vitest";
import {
  attendanceSectionBlock,
  matchSimpleBlock,
  normalizeProfileBlocks,
  primarySimpleBlock,
  viewerCompetitionBlocks,
  normalizeAudienceBlocks,
} from "@/lib/constants";

describe("block normalization", () => {
  it("merges jump and throw memberships into short distance", () => {
    expect(normalizeProfileBlocks(["jump", "throw"])).toEqual(["short"]);
    expect(normalizeProfileBlocks(["middle_long", "jump", "short"])).toEqual(["middle_long"]);
  });

  it("uses the short-distance attendance tab for legacy memberships", () => {
    expect(matchSimpleBlock(["jump"], "short")).toBe(true);
    expect(matchSimpleBlock(["throw"], "short")).toBe(true);
    expect(primarySimpleBlock(["jump"])).toBe("short");
    expect(primarySimpleBlock(["throw"])).toBe("short");
  });

  it("treats managers as both blocks in filters", () => {
    expect(normalizeProfileBlocks(["manager", "short"])).toEqual(["manager"]);
    expect(matchSimpleBlock(["manager"], "middle_long")).toBe(true);
    expect(matchSimpleBlock(["manager"], "short")).toBe(true);
    expect(primarySimpleBlock(["manager"])).toBe("middle_long");
    expect(viewerCompetitionBlocks(["manager"])).toEqual(["middle_long", "short"]);
    expect(attendanceSectionBlock(["manager"])).toBe("manager");
    expect(attendanceSectionBlock(["middle_long"])).toBe("middle_long");
    expect(attendanceSectionBlock(["short"])).toBe("short");
  });

  it("keeps middle-long memberships separate", () => {
    expect(matchSimpleBlock(["middle_long"], "short")).toBe(false);
    expect(primarySimpleBlock(["middle_long"])).toBe("middle_long");
  });
});

describe("normalizeAudienceBlocks", () => {
  // 通知先の複数選択を1つに畳んでしまうと、編集して保存し直すたびに対象が黙って狭まる。
  it("選んだブロックをすべて残す", () => {
    expect(normalizeAudienceBlocks(["middle_long", "short"])).toEqual(["middle_long", "short"]);
  });

  it("マネージャーを他のブロックと併用できる", () => {
    expect(normalizeAudienceBlocks(["manager", "middle_long"])).toEqual(["middle_long", "manager"]);
  });

  it("過去互換の jump/throw を短距離へ寄せて重複を除く", () => {
    expect(normalizeAudienceBlocks(["jump", "throw", "short"])).toEqual(["short"]);
  });

  it("未選択・null を空配列にする", () => {
    expect(normalizeAudienceBlocks([])).toEqual([]);
    expect(normalizeAudienceBlocks(null)).toEqual([]);
  });
});
