import { describe, it, expect } from "vitest";
import { competitionDays } from "./competition";
describe("competition calendar countdown", () => {
  it("counts the first day as zero", () =>
    expect(competitionDays("2026-09-21", "2026-09-21")).toBe(0));
  it("counts JST calendar dates before and after the event", () => {
    expect(competitionDays("2026-09-21", "2026-09-08")).toBe(13);
    expect(competitionDays("2026-09-21", "2026-09-20")).toBe(1);
    expect(competitionDays("2026-09-21", "2026-09-22")).toBe(-1);
  });
});
