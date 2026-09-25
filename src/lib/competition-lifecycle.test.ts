import { describe, expect, it } from "vitest";
import { isCompetitionArchived, selectHomeCompetition } from "./competition-lifecycle";

const old = { id: "old", starts_on: "2026-09-21", ends_on: "2026-09-23", is_countdown: true, archive_at: "2026-09-25T08:00:00+09:00" };
const next = { id: "next", starts_on: "2026-09-25", ends_on: "2026-09-27", is_countdown: false, archive_at: null };
describe("competition archive", () => {
  it("switches at 08:00 JST exactly, including UTC input", () => {
    expect(isCompetitionArchived(old, Date.parse("2026-09-24T22:59:59Z"))).toBe(false);
    expect(isCompetitionArchived(old, Date.parse("2026-09-24T23:00:00Z"))).toBe(true);
  });
  it("retains the selected event until the archive deadline then chooses the next event", () => {
    expect(selectHomeCompetition([old, next], Date.parse("2026-09-25T07:59:59+09:00"))?.id).toBe("old");
    expect(selectHomeCompetition([old, next], Date.parse("2026-09-25T08:00:00+09:00"))?.id).toBe("next");
    expect(old.is_countdown).toBe(true);
  });
  it("does not resurrect old events or override an explicit selection", () => {
    const now = Date.parse("2026-09-25T08:00:00+09:00");
    expect(selectHomeCompetition([old], now)).toBeNull();
    expect(selectHomeCompetition([next], now)).toBeNull();
    expect(selectHomeCompetition([old, { ...next, is_countdown: true }], now)?.id).toBe("next");
    expect(isCompetitionArchived({ archive_at: null }, now)).toBe(false);
  });
});
