import { describe, expect, it } from "vitest";
import { hydrateRecordFieldGroups } from "./record-field-groups";

describe("grouped record definitions", () => {
  it("keeps historical labels, visibility, and shared array identity", () => {
    const rows = [{ id: "a", record_fields_version: 2 }, { id: "b", record_fields_version: 2 }];
    const fields = [{ key: "custom", label: "以前の項目名", type: "text", hidden: true, showInTimeline: false }];
    const result = hydrateRecordFieldGroups(rows, [{ record_ids: ["a", "b"], record_fields_version: 2, fields }]);
    expect(result[0]).toMatchObject({ record_fields_snapshot: fields });
    expect(result[1]).toMatchObject({ record_fields_snapshot: fields });
    expect(Reflect.get(result[0], "record_fields_snapshot")).toBe(Reflect.get(result[1], "record_fields_snapshot"));
  });

  it("keeps different snapshots even for the same version number", () => {
    const fields = [{ key: "custom", label: "別の定義", type: "text" }];
    const result = hydrateRecordFieldGroups([{ id: "a", record_fields_version: 1 }, { id: "b", record_fields_version: 1 }], [
      { record_ids: ["a"], record_fields_version: 1, fields: [] },
      { record_ids: ["b"], record_fields_version: 1, fields },
    ]);
    expect(result[0]).toMatchObject({ record_fields_snapshot: [] });
    expect(result[1]).toMatchObject({ record_fields_snapshot: fields });
  });

  it("uses author fields only for unversioned records", () => {
    const author = { id: "user", display_name: "member", avatar_url: null, blocks: [], grade: null };
    const fields = [{ key: "custom", label: "現在の項目名", type: "text" }];
    const result = hydrateRecordFieldGroups([{ id: "a", record_fields_version: null, author }], [
      { record_ids: ["a"], record_fields_version: null, fields },
    ]);
    expect(result[0].author).toMatchObject({ record_fields: fields });
  });

  it("does not substitute current fields for an empty historical snapshot", () => {
    const result = hydrateRecordFieldGroups([{ id: "a", record_fields_version: 3 }], [
      { record_ids: ["a"], record_fields_version: 3, fields: [] },
    ]);
    expect(result[0]).toMatchObject({ record_fields_snapshot: [] });
  });

  it("rejects missing or concurrently changed definitions", () => {
    expect(() => hydrateRecordFieldGroups([{ id: "a", record_fields_version: 1 }], [])).toThrow();
    expect(() => hydrateRecordFieldGroups([{ id: "a", record_fields_version: 1 }], [
      { record_ids: ["a"], record_fields_version: 2, fields: [] },
    ])).toThrow();
  });
});
