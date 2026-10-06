import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OB_ENTRY_EVENTS, entryDivision, validEntryDetails, validEntryEdit, type EntryEdit } from "./ob-entry-edit";
import { GRADE_OPTIONS } from "./constants";
const base: EntryEdit = { entryId: "10000000-0000-4000-8000-000000000001", profileId: null, revision: 1, events: ["男子100m"], marks: { "男子100m": "12秒34" } };
it("accepts adding a member, changing records and cancelling without deleting the entry", () => {
  expect(validEntryEdit(base)).toBe(true);
  expect(validEntryEdit({ ...base, entryId: null, profileId: base.entryId, revision: null })).toBe(true);
  expect(validEntryEdit({ ...base, events: [], marks: {} })).toBe(true);
});
it("rejects unsupported events, duplicates, unrelated marks, long text and mixed edit identities", () => {
  const changes: Partial<EntryEdit>[] = [{ events: ["自由種目"] }, { events: ["男子100m", "男子100m"] }, { marks: { "女子100m": "13秒" } }, { marks: { "男子100m": "a".repeat(1001) } }, { revision: -1 }, { profileId: base.entryId }];
  for (const change of changes) {
    expect(validEntryEdit({ ...base, ...change })).toBe(false);
  }
  expect(validEntryEdit({ ...base, entryId: null, profileId: base.entryId, revision: null, events: [], marks: {} })).toBe(false);
});
it("keeps the editor catalogue aligned with database validation", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260924050000_ob_entry_edit.sql", import.meta.url), "utf8");
  for (const event of OB_ENTRY_EVENTS) expect(sql).toContain(`('${event.slice(2)}')`);
  expect(OB_ENTRY_EVENTS).toHaveLength(22);
});

it("rejects mixing competition divisions and preserves division after cancellation", () => {
  expect(validEntryEdit({...base,events:["男子100m","女子300m"],marks:{}})).toBe(false);
  expect(entryDivision({events:[],competition_division:"女子"})).toBe("女子");
  expect(entryDivision({events:["女子100m"]})).toBe("女子");
  expect(entryDivision({events:[]})).toBe(null);
  expect(entryDivision({events:["男子100m","女子100m"]})).toBe(null);
});

it("accepts existing imported entry details for every current grade without mutating the payload", () => {
  for (const grade of [...GRADE_OPTIONS.map(value => value.short), "OB・OG"]) {
    const details = { name: " 合成修正名 ", grade };
    const input = { ...base, details };
    expect(validEntryDetails(details)).toBe(true); expect(validEntryEdit(input)).toBe(true);
    expect(input.details).toEqual({ name: " 合成修正名 ", grade });
  }
  expect(validEntryDetails({ name: "x".repeat(100), grade: "B1" })).toBe(true);
  expect(validEntryEdit({ ...base, events: [], marks: {}, details: { name: "合成修正名", grade: "M1" } })).toBe(true);
});

it("rejects invalid or oversized detail objects and details on a new profile registration", () => {
  const invalid: unknown[] = [null, [], "合成", {}, { name: "合成" }, { grade: "B1" }, { name: " ", grade: "B1" }, { name: "　", grade: "B1" },
    { name: "x".repeat(101), grade: "B1" }, { name: 123, grade: "B1" }, { name: "合成", grade: 1 }, { name: "合成", grade: "1" },
    { name: "合成", grade: "unknown" }, { name: "合成", grade: "B1", profileId: base.entryId },
  ];
  for (const details of invalid) {
    expect(validEntryDetails(details)).toBe(false);
    expect(validEntryEdit({ ...base, details } as EntryEdit)).toBe(false);
  }
  expect(validEntryEdit({ ...base, entryId: null, profileId: base.entryId, revision: null, details: { name: "合成", grade: "B1" } })).toBe(false);
  expect(validEntryEdit({ ...base, details: undefined })).toBe(true);
});
