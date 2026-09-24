export const OB_ENTRY_EVENTS = ["男子", "女子"].flatMap((gender) =>
  ["100m", "300m", "300mH", "1500m", "3000m", "走り幅跳び", "走り高跳び", "立ち五段", "砲丸投げ", "やり投げ", "ジャベリックスロー"].map((event) => gender + event));
export type EntryEdit = { entryId: string | null; profileId: string | null; revision: number | null; events: string[]; marks: Record<string, string | null> };
export function validEntryEdit(input: EntryEdit): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!input || typeof input !== "object") return false;
  if (input.entryId === null ? !input.profileId || !uuid.test(input.profileId) || input.revision !== null : !uuid.test(input.entryId) || !Number.isSafeInteger(input.revision) || input.revision! < 0 || input.profileId !== null) return false;
  if (!Array.isArray(input.events) || input.events.length > 22 || new Set(input.events).size !== input.events.length || input.events.some((event) => !OB_ENTRY_EVENTS.includes(event)) || (input.entryId === null && !input.events.length)) return false;
  return !!input.marks && typeof input.marks === "object" && !Array.isArray(input.marks) && Object.entries(input.marks).every(([event, mark]) => input.events.includes(event) && (mark === null || typeof mark === "string" && mark.length <= 1000));
}

export type EntryChange = { id: string; changed_at: string; actor_id: string | null; before_data: unknown; after_data: unknown };
