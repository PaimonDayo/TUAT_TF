import { describe, expect, it } from "vitest";
import { hasCustomRecordContent } from "@/lib/record-content";

describe("hasCustomRecordContent", () => {
  it.each([null, undefined, "", " \n", 0, "0", " 0.00 ", "-0", "+00.0"])("ignores blank/zero placeholder %s", (value) => {
    expect(hasCustomRecordContent(value)).toBe(false);
  });
  it.each(["休養", "0から再開", "10", 0.01, -1, "独り言"])("keeps real content %s", (value) => {
    expect(hasCustomRecordContent(value)).toBe(true);
  });
});
