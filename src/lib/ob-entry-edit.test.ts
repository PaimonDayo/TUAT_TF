import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OB_ENTRY_EVENTS, validEntryEdit, type EntryEdit } from "./ob-entry-edit";
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
