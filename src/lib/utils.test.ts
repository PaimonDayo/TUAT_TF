import { describe, expect, it } from "vitest";
import { formatKm, roundKm } from "./utils";

describe("kilometer precision", () => {
  it("shows up to two decimal places without forcing trailing zeroes", () => {
    expect(formatKm(12)).toBe("12");
    expect(formatKm(12.5)).toBe("12.5");
    expect(formatKm(12.34)).toBe("12.34");
  });

  it("rounds distance values to two decimal places", () => {
    expect(roundKm(12.345)).toBe(12.35);
  });
});
