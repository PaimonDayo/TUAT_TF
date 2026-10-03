import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ObEventOperation } from "./ob-operations";

export type ObDayEntryInput = {
  operationId: string;
  event: string;
  entryId?: string | null;
  revision?: number | null;
  name?: string;
  grade?: string;
  group?: number | null;
};
type AttendanceResult = { entryId: string; revision: number; absent: boolean };
type DayEntryResult = { entryId: string; saved: ObEventOperation };
type OperationDatabase = Omit<Database, "public"> & { public: Omit<Database["public"], "Tables" | "Functions"> & {
  Tables: Database["public"]["Tables"] & { ob_event_operations: { Row: ObEventOperation; Insert: never; Update: never; Relationships: [] } };
  Functions: Database["public"]["Functions"] & {
    save_ob_event_operation: { Args: { p_event: string; p_revision: number | null; p_data: Json }; Returns: ObEventOperation };
    save_ob_event_operation_checked: { Args: { p_event: string; p_revision: number | null; p_data: Json; p_base_data: Json }; Returns: ObEventOperation };
    set_ob_attendance: { Args: { p_entry_id: string; p_revision: number; p_absent: boolean }; Returns: AttendanceResult };
    add_ob_day_entry: { Args: { p_request_id: string; p_event: string; p_entry_id: string | null; p_revision: number | null; p_name: string | null; p_grade: string | null; p_group: number | null }; Returns: DayEntryResult };
  };
} };
export function operationClient(client: SupabaseClient<Database>) { return client as unknown as SupabaseClient<OperationDatabase>; }
