import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ObEventOperation } from "./ob-operations";

type OperationDatabase = Omit<Database,"public"> & { public: Omit<Database["public"],"Tables"|"Functions"> & {
  Tables: Database["public"]["Tables"] & { ob_event_operations: { Row: ObEventOperation; Insert: never; Update: never; Relationships: [] } };
  Functions: Database["public"]["Functions"] & { save_ob_event_operation: { Args: {p_event:string;p_revision:number|null;p_data:Json}; Returns: ObEventOperation } };
} };
export function operationClient(client:SupabaseClient<Database>) { return client as unknown as SupabaseClient<OperationDatabase>; }
