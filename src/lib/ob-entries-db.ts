import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ObEntry } from "./ob-entries";

type EntryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      ob_meet_entries: {
        Row: ObEntry;
        Insert: { id?: string; meet_key: string; submitted_name: string; grade: string; events: string[]; profile_id?: string | null; revision?: number; imported_at?: string };
        Update: Partial<ObEntry>;
        Relationships: [];
      };
    };
  };
};

export function entryClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<EntryDatabase>;
}
