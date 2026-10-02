"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { operationClient } from "@/lib/ob-operations-db";
import { OB_ENTRY_EVENTS } from "@/lib/ob-entry-edit";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";
import { MeetEvent, type MeetEventData } from "@/lib/meet-operations";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import type { Json } from "@/types/database";

export async function saveObEventOperation(input: {event:string;revision:number|null;data:MeetEventData}):Promise<{ok:boolean;message?:string;saved?:ObEventOperation}> {
  if (!input || !OB_ENTRY_EVENTS.includes(input.event) || !(input.revision===null||Number.isSafeInteger(input.revision)&&input.revision>=0) || !input.data || typeof input.data!=="object" || JSON.stringify(input.data).length>250000) return {ok:false,message:"入力内容を確認してください"};
  const invalid=new MeetEvent(obEventRule(input.event),input.data).validate();
  if(invalid)return {ok:false,message:invalid};
  const client=await createClient();
  const {data:{user}}=await client.auth.getUser();
  if(!user||await isMemberPreviewActive())return {ok:false,message:"権限がありません"};
  const roles=await fetchRolesByProfileIds(client,[user.id]);
  if(!permissionsOf(roles.get(user.id)).manageSystem)return {ok:false,message:"システム管理権限が必要です"};
  const result=await operationClient(client).rpc("save_ob_event_operation",{p_event:input.event,p_revision:input.revision,p_data:input.data as unknown as Json});
  if(result.error)return {ok:false,message:result.error.message.includes("operation_conflict")?"他の端末で更新されています。入力を控えて画面を開き直してください。上書きはしていません":result.error.message.includes("operation_roster")?"出場登録が変更されています。入力を控えて画面を開き直してください": "保存できませんでした。入力を確認して再度保存してください"};
  if(!result.data)return {ok:false,message:"保存結果を確認できませんでした。画面を開き直してください"};
  revalidatePath(OB_PROGRAM_PATH);
  return {ok:true,saved:result.data};
}
