import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ObEntry } from "./ob-entries";
import type { EntryChange } from "./ob-entry-edit";
import type { ObDuty } from "./ob-duty";
import type { ObPartyResponse } from "./ob-meet";

type EntryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      save_ob_duty: { Args: { p_profile_id: string; p_slot_time: string; p_assignment: string; p_revision: number | null }; Returns: number };
      save_ob_party: { Args: { p_id: string; p_revision: number; p_status: string }; Returns: string };
      save_ob_registration: { Args: { p_entry_id: string | null; p_profile_id: string | null; p_revision: number | null; p_events: string[]; p_marks: Record<string,string|null>; p_party_id: string | null; p_party_revision: number | null; p_party_status: string }; Returns: string };
      save_ob_entry: { Args: { p_entry_id: string | null; p_profile_id: string | null; p_revision: number | null; p_events: string[]; p_marks: Record<string, string | null> }; Returns: string };
    };
    Tables: Database["public"]["Tables"] & {
      ob_meet_duties: { Row: ObDuty; Insert: never; Update: never; Relationships: [] };
      ob_party_responses: { Row: ObPartyResponse; Insert: never; Update: never; Relationships: [] };
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
