import { recordFieldsFromJson } from "@/lib/profile-normalize";
import type { AuthorMini, RecordFieldDef } from "@/types";
import type { Json } from "@/types/database";

export type RecordFieldGroup = {
  record_ids: string[];
  record_fields_version: number | null;
  fields: Json;
};

/** Reuse each definition array; an empty historical snapshot never falls back. */
export function hydrateRecordFieldGroups<T extends {
  id: string;
  record_fields_version?: number | null;
  record_fields_snapshot?: RecordFieldDef[];
  author?: AuthorMini;
}>(records: T[], groups: RecordFieldGroup[]): T[] {
  const byId = new Map<string, { version: number | null; fields: RecordFieldDef[] }>();
  for (const group of groups) {
    const definition = { version: group.record_fields_version, fields: recordFieldsFromJson(group.fields) };
    for (const id of group.record_ids) byId.set(id, definition);
  }
  return records.map((record) => {
    const definition = byId.get(record.id);
    // A concurrent deletion/config-version change must not silently relabel a card.
    if (!definition || definition.version !== (record.record_fields_version ?? null)) {
      throw new Error("Record field definitions changed; reload the records");
    }
    if (record.record_fields_version != null) {
      return { ...record, record_fields_snapshot: definition.fields };
    }
    return record.author
      ? { ...record, author: { ...record.author, record_fields: definition.fields } }
      : record;
  });
}
