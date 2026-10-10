import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { entryClient } from "@/lib/ob-entries-db";
import { operationClient } from "@/lib/ob-operations-db";
import { OB_MEET } from "@/lib/ob-meet";
import type { ObEntry } from "@/lib/ob-entries";

/** Read only the fields needed for the shared results; never query contact or party answers. */
export async function getObPublishedResults(admin: SupabaseClient<Database>) {
  const [entries, operations] = await Promise.all([readEntries(admin), readOperations(admin)]);
  return { entries, operations };
}

async function readEntries(admin: SupabaseClient<Database>): Promise<ObEntry[]> {
  const client = entryClient(admin);
  const entries: ObEntry[] = [];
  let expected: number | undefined;
  // Supabase's response limit must not silently omit late registrations.
  do {
    const { data, error, count } = await client.from("ob_meet_entries")
      .select("id,meet_key,submitted_name,grade,events,absent,revision", { count: "exact" })
      .eq("meet_key", OB_MEET.meetKey).order("id").range(entries.length, entries.length + 999);
    if (error || !data || count === null || !Number.isSafeInteger(count) || count < 0 || (expected !== undefined && expected !== count)) {
      throw new Error("共有用のエントリー情報を取得できませんでした");
    }
    expected = count;
    if ((!data.length && entries.length < count) || entries.length + data.length > count) {
      throw new Error("共有用のエントリー情報を最後まで取得できませんでした");
    }
    entries.push(...data.map(row => ({ ...row, profile_id: null, imported_at: "", qualification_marks: {} })));
  } while (entries.length < expected);
  if (new Set(entries.map(row => row.id)).size !== entries.length) throw new Error("共有用のエントリー情報が取得中に変わりました");
  return entries;
}

async function readOperations(admin: SupabaseClient<Database>) {
  const { data, error, count } = await operationClient(admin).from("ob_event_operations")
    .select("meet_key,event_name,revision,data,updated_at", { count: "exact" }).eq("meet_key", OB_MEET.meetKey);
  if (error || !data || count === null || !Number.isSafeInteger(count) || data.length !== count) throw new Error("共有用の組・記録を最後まで取得できませんでした");
  return data;
}
