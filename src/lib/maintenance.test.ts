import { describe, expect, it } from "vitest";
import { isMaintenanceWindow } from "./maintenance";

describe("isMaintenanceWindow", () => {
  it("is false before the window starts", () => {
    expect(isMaintenanceWindow(new Date("2026-09-16T05:59:59Z"))).toBe(false);
  });

  it("is true at the start of the window (2026-09-16 15:00 JST)", () => {
    expect(isMaintenanceWindow(new Date("2026-09-16T06:00:00Z"))).toBe(true);
  });

  it("is true in the middle of the window", () => {
    expect(isMaintenanceWindow(new Date("2026-09-17T00:00:00Z"))).toBe(true);
  });

  it("is true just before the window ends (2026-09-17 19:00 JST)", () => {
    expect(isMaintenanceWindow(new Date("2026-09-17T09:59:59Z"))).toBe(true);
  });

  it("is false once the window has ended", () => {
    expect(isMaintenanceWindow(new Date("2026-09-17T10:00:00Z"))).toBe(false);
  });
});
