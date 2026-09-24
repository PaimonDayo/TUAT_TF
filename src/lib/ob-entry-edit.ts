export const OB_ENTRY_EVENTS = ["男子", "女子"].flatMap((gender) =>
  ["100m", "300m", "300mH", "1500m", "3000m", "走り幅跳び", "走り高跳び", "立ち五段", "砲丸投げ", "やり投げ", "ジャベリックスロー"].map((event) => gender + event));
export type EntryEdit = { entryId: string | null; profileId: string | null; revision: number | null; events: string[]; marks: Record<string, string | null> };
export function entryDivision(entry: { events: string[]; competition_division?: "男子" | "女子" | null }): "男子" | "女子" | null {
  if (entry.competition_division) return entry.competition_division;
  const divisions = new Set(entry.events.map((event) => event.slice(0, 2)));
  if (divisions.size !== 1) return null;
  const division = [...divisions][0];
  return division === "男子" || division === "女子" ? division : null;
}
export function validEntryEdit(input: EntryEdit, allowPartyOnly = false): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!input || typeof input !== "object") return false;
  if (input.entryId === null ? !input.profileId || !uuid.test(input.profileId) || input.revision !== null : !uuid.test(input.entryId) || !Number.isSafeInteger(input.revision) || input.revision! < 0 || input.profileId !== null) return false;
  if (!Array.isArray(input.events) || input.events.length > 22 || new Set(input.events).size !== input.events.length || input.events.some((event) => !OB_ENTRY_EVENTS.includes(event)) || (input.entryId === null && !input.events.length && !allowPartyOnly)) return false;
  if (input.events.length && !entryDivision({ events: input.events })) return false;
  return !!input.marks && typeof input.marks === "object" && !Array.isArray(input.marks) && Object.entries(input.marks).every(([event, mark]) => input.events.includes(event) && (mark === null || typeof mark === "string" && mark.length <= 1000));
}

export type EntryChange = { id: string; changed_at: string; actor_id: string | null; before_data: unknown; after_data: unknown };
