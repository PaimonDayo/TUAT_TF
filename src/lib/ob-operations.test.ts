import { describe, expect, it } from "vitest";
import { effectiveObParticipation, hasRecordedObPerformance, obEventParticipants, ObMeetRoster, reconcileObEvent } from "./ob-operations";
import { emptyPerformance, type MeetEventData } from "./meet-operations";
import { OB_DUTY_SLOTS } from "./ob-meet";
import type { ObEntry } from "./ob-entries";

const entry: ObEntry = { id: "e", meet_key: "ob-2026", submitted_name: "合成人物", grade: "B1", profile_id: "p", events: ["男子1500m"], qualification_marks: {}, revision: 0, imported_at: "" };

describe("effective competition participation", () => {
  it("separates whole-meet absence from explicit event DNS and restores attendance without changing DNS", () => {
    const performance = emptyPerformance(entry.id);
    expect(effectiveObParticipation("男子1500m", entry, performance)).toMatchObject({ status: "entered", canParticipate: true, recorded: false });
    expect(effectiveObParticipation("男子1500m", { ...entry, absent: true }, performance)).toMatchObject({ status: "absent", canParticipate: false });
    const dns = { ...performance, status: "DNS" as const };
    expect(effectiveObParticipation("男子1500m", { ...entry, absent: false }, dns)).toMatchObject({ status: "DNS", canParticipate: false });
    expect(hasRecordedObPerformance(dns)).toBe(false);
  });

  it("preserves recorded results after absence or cancellation, including fouls, DNF and DQ", () => {
    const performance = { ...emptyPerformance(entry.id), group: 1, order: 2, trials: [{ mark: "4:05.30", status: "valid" as const, wind: "" }] };
    const saved: MeetEventData = { confirmed: true, participants: [performance] };
    const before = JSON.stringify([entry, saved]);
    for (const person of [{ ...entry, absent: true }, { ...entry, events: [] }]) {
      const state = effectiveObParticipation("男子1500m", person, performance);
      expect(state).toMatchObject({ status: "entered", recorded: true, canParticipate: false });
      expect(reconcileObEvent("男子1500m", [person], saved)).toEqual(saved);
      expect(obEventParticipants("男子1500m", [person], saved)).toHaveLength(1);
    }
    expect(hasRecordedObPerformance({ ...performance, trials: [{ mark: "", status: "foul", wind: "" }] })).toBe(true);
    for (const status of ["DNF", "DQ"] as const) expect(hasRecordedObPerformance({ ...performance, status, trials: [] })).toBe(true);
    expect(JSON.stringify([entry, saved])).toBe(before);
  });

  it("keeps original unrecorded statuses, positions and registration data while showing absence/cancellation", () => {
    const performance = { ...emptyPerformance(entry.id), group: 2, order: 3 };
    const saved: MeetEventData = { confirmed: true, participants: [performance] };
    const absent = { ...entry, absent: true };
    const reconciled = reconcileObEvent("男子1500m", [absent], saved);
    expect(reconciled).toEqual(saved);
    expect(reconciled.participants[0]).toBe(performance);
    expect(absent.events).toEqual(["男子1500m"]);
    expect(reconcileObEvent("男子1500m", [entry], saved).confirmed).toBe(false);
    expect(effectiveObParticipation("男子1500m", { ...entry, events: [] }, performance).status).toBe("withdrawn");
    expect(effectiveObParticipation("男子1500m", undefined, performance).status).toBe("missing");
  });

  it("adds new entries once while retaining removed registrations and unknown saved participants", () => {
    const old = emptyPerformance("old");
    const saved = { participants: [old], confirmed: true };
    const rows = obEventParticipants("男子1500m", [entry], saved);
    expect(rows.map(row => row.entryId)).toEqual(["old", "e"]);
    expect(rows[0].state.status).toBe("missing");
    expect(reconcileObEvent("男子1500m", [entry], saved).confirmed).toBe(false);
    expect(obEventParticipants("男子1500m", [entry], { participants: [emptyPerformance("e")], confirmed: false })).toHaveLength(1);
  });

  it("labels DNS and absence in helper tables without clearing scheduled competition blocks", () => {
    const slot = OB_DUTY_SLOTS.find(slot => slot.events.includes("1500m"))!;
    const operations = [{ meet_key: "ob-2026", event_name: "男子1500m", revision: 1, updated_at: "", data: { confirmed: false, participants: [{ ...emptyPerformance("e"), status: "DNS" as const }] } }];
    expect(ObMeetRoster.cell(entry, slot, operations)).toMatchObject({ kind: "competing", dns: ["男子1500m"] });
    expect(ObMeetRoster.cell({ ...entry, absent: true }, slot, operations).kind).toBe("absent");
    const result = { ...operations[0], data: { confirmed: true, participants: [{ ...emptyPerformance("e"), trials: [{ mark: "4:05.3", status: "valid" as const, wind: "" }] }] } };
    expect(ObMeetRoster.cell({ ...entry, events: [] }, slot, [result])).toMatchObject({ kind: "competing", events: ["男子1500m"] });
  });
});
