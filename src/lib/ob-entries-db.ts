import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ObEntry } from "./ob-entries";
import type { EntryChange } from "./ob-entry-edit";
import type { ObOperationChange } from "./ob-entry-history";
import type { ObDuty, ObDutyRole, ObEntryDuty } from "./ob-duty";
import type { ObPartyResponse } from "./ob-meet";
import type { Json } from "@/types/database";

type EntryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      save_ob_registration_checked: { Args: {p_entry_id:string|null;p_profile_id:string|null;p_revision:number|null;p_events:string[];p_marks:Record<string,string|null>;p_party_id:string|null;p_party_revision:number|null;p_party_status:string|null;p_confirm_duties:boolean}; Returns:Json };
      save_ob_role_people: { Args: {p_role_id:string;p_revision:number;p_expected:Json;p_people:string[]}; Returns:string };
      create_ob_guest_registration: { Args: {p_name:string;p_grade:string;p_events:string[];p_marks:Record<string,string|null>;p_party_status:string;p_party_id:string|null;p_party_revision:number|null}; Returns:string };
      delete_ob_registration: { Args: {p_entry_id:string;p_revision:number}; Returns:string };
      claim_ob_entry: { Args: Record<string, never>; Returns: string };
      save_ob_entry_duty_roles: { Args: {p_entry_id:string;p_slot_time:string;p_event_name:string;p_role_ids:string[];p_revision:number|null}; Returns:number };
      save_ob_duty_roles: { Args: {p_profile_id:string;p_slot_time:string;p_event_name:string;p_role_ids:string[];p_revision:number|null}; Returns:number };
      save_ob_duty_role: { Args: {p_id:string|null;p_slot_time:string;p_event_name:string;p_name:string;p_abbreviation:string;p_required_count:number;p_revision:number|null}; Returns:string };
      delete_ob_duty_role: { Args: {p_id:string;p_slot_time:string;p_event_name:string;p_revision:number}; Returns:string };
      save_ob_duty: { Args: { p_profile_id: string; p_slot_time: string; p_event_name: string; p_assignment: string; p_revision: number | null }; Returns: number };
      save_ob_party: { Args: { p_id: string; p_revision: number; p_status: string }; Returns: string };
      save_ob_registration: { Args: { p_entry_id: string | null; p_profile_id: string | null; p_revision: number | null; p_events: string[]; p_marks: Record<string,string|null>; p_party_id: string | null; p_party_revision: number | null; p_party_status: string }; Returns: string };
      save_ob_entry: { Args: { p_entry_id: string | null; p_profile_id: string | null; p_revision: number | null; p_events: string[]; p_marks: Record<string, string | null> }; Returns: string };
    };
    Tables: Database["public"]["Tables"] & {
      ob_duty_roles: { Row: ObDutyRole; Insert: never; Update: never; Relationships: [] };
      ob_meet_duties: { Row: ObDuty; Insert: never; Update: never; Relationships: [] };
      ob_entry_duties: { Row: ObEntryDuty; Insert: never; Update: never; Relationships: [] };
      ob_party_responses: { Row: ObPartyResponse; Insert: never; Update: never; Relationships: [] };
      ob_entry_changes: { Row: EntryChange & { entry_id: string | null }; Insert: never; Update: never; Relationships: [] };
      ob_operation_changes: { Row: ObOperationChange; Insert: never; Update: never; Relationships: [] };
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
