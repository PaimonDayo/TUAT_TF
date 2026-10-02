import { createClient } from "@/lib/supabase/server";
import { operationClient } from "@/lib/ob-operations-db";
export async function getObEventOperations() {
  const client=operationClient(await createClient());
  const {data,error}=await client.from("ob_event_operations").select("meet_key,event_name,revision,data,updated_at").eq("meet_key","ob-2026");
  if(error)throw new Error("組み分け・試技記録を取得できませんでした");
  return data??[];
}
