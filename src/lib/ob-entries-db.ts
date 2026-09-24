import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ObEntry } from "./ob-entries";
import type { EntryChange } from "./ob-entry-edit";

type EntryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      save_ob_entry: { Args: { p_entry_id: string | null; p_profile_id: string | null; p_revision: number | null; p_events: string[]; p_marks: Record<string, string | null> }; Returns: string };
    };
    Tables: Database["public"]["Tables"] & {
      ob_entry_changes: { Row: EntryChange & { entry_id: string }; Insert: never; Update: never; Relationships: [] };
      ob_meet_entries: {
        Row: ObEntry;
        Insert: { id?: string; meet_key: string; submitted_name: string; grade: string; events: string[]; qualification_marks?: Record<string, string | null>; profile_id?: string | null; revision?: number; imported_at?: string };
        Update: Partial<ObEntry>;
        Relationships: [];
      };
    };
  };
};

export function entryClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<EntryDatabase>;
}
