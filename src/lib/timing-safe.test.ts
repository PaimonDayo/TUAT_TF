import { describe, expect, it } from "vitest";
import { timingSafeEqualString } from "./timing-safe";

describe("timingSafeEqualString", () => {
  it("accepts identical values", () => expect(timingSafeEqualString("secret", "secret")).toBe(true));
  it("rejects same-length different values", () => expect(timingSafeEqualString("secret", "secRet")).toBe(false));
  it("rejects different lengths", () => expect(timingSafeEqualString("secret", "secret2")).toBe(false));
  it("accepts two empty values", () => expect(timingSafeEqualString("", "")).toBe(true));
  it("handles UTF-8 values by byte length", () => expect(timingSafeEqualString("部活", "部活")).toBe(true));
});
