import { describe, expect, it } from "vitest";
import { computeMemberPull, type DbRecord } from "./sheet-sync";

const fieldMap = {
  builtin: new Map([["memo", { header: "memo", numeric: false }]]),
  custom: new Map(),
} as Parameters<typeof computeMemberPull>[1];

function dbRecord(date: string, memo: string): DbRecord {
  return {
    id: `record-${date}`, user_id: "user-1", recorded_date: date,
    dist_low: 0, dist_mid: 0, dist_high: 0, dist_speed: 0, strides: 0,
    strength_text: null, result_text: null, memo, menu_text: null, focus_text: null,
    custom: {}, updated_at: null, synced_at: null,
  };
}

describe("computeMemberPull", () => {
  const sheetRecords = [
    { date: "2026-07-23", cells: { memo: "sheet value" } },
    { date: "2026-07-24", cells: { memo: "CSV-only post" } },
  ];
  const existing = new Map<string, DbRecord[]>([["2026-07-23", [dbRecord("2026-07-23", "app value")]]]);

  it("preserves an existing app record and imports only a missing CSV date", () => {
    const result = computeMemberPull("user-1", fieldMap, sheetRecords, existing, () => true, "2026-07-24T15:00:00.000Z", "preserve");
    expect(result.updates).toEqual([]);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]).toMatchObject({ user_id: "user-1", recorded_date: "2026-07-24", from_sheet: true, memo: "CSV-only post" });
  });

  it("keeps sheet-main merge behavior for an existing date", () => {
    const result = computeMemberPull("user-1", fieldMap, sheetRecords, existing, () => true, "2026-07-24T15:00:00.000Z", "merge");
    expect(result.updates).toEqual([{ id: "record-2026-07-23", patch: { memo: "sheet value", synced_at: "2026-07-24T15:00:00.000Z" } }]);
    expect(result.inserts).toHaveLength(1);
  });
});
