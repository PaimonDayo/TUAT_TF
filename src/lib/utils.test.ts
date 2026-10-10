import { describe, expect, it } from "vitest";
import { cn, formatKm, roundKm } from "./utils";

it("keeps the requested loading and icon shapes without conflicting defaults", () => {
  expect(cn("animate-pulse rounded-md", "rounded-card")).toBe("animate-pulse rounded-card");
  expect(cn("rounded-md", "rounded-control")).toBe("rounded-control");
  expect(cn("rounded-control", "rounded-full")).toBe("rounded-full");
  expect(cn("rounded-card md:rounded-control", "rounded-none")).toBe("md:rounded-control rounded-none");
});

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
