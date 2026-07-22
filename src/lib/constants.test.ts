import { describe, expect, it } from "vitest";
import {
  matchSimpleBlock,
  normalizeProfileBlocks,
  primarySimpleBlock,
} from "@/lib/constants";

describe("block normalization", () => {
  it("merges jump and throw memberships into short distance", () => {
    expect(normalizeProfileBlocks(["jump", "throw"])).toEqual(["short"]);
    expect(normalizeProfileBlocks(["middle_long", "jump", "short"])).toEqual([
      "middle_long",
      "short",
    ]);
  });

  it("uses the short-distance attendance tab for legacy memberships", () => {
    expect(matchSimpleBlock(["jump"], "short")).toBe(true);
    expect(matchSimpleBlock(["throw"], "short")).toBe(true);
    expect(primarySimpleBlock(["jump"])).toBe("short");
    expect(primarySimpleBlock(["throw"])).toBe("short");
  });

  it("keeps middle-long memberships separate", () => {
    expect(matchSimpleBlock(["middle_long"], "short")).toBe(false);
    expect(primarySimpleBlock(["middle_long"])).toBe("middle_long");
  });
});
