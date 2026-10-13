"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isMemberPreviewActive } from "@/lib/supabase/auth";
import type { MeetCommand, MeetMutationResult } from "@/lib/competition-meet";
import type { Json } from "@/types/database";
import { scheduleObResultsPublish } from "@/lib/ob-results-notify";
import { isObCompetition } from "@/lib/ob-meet";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const competitionKey = /^[a-zA-Z0-9_-]{1,100}$/;
function refresh(competitionId:string) {
  revalidatePath(`/competitions/${competitionId}/program`);
  revalidatePath(`/competitions/${competitionId}/manage`);
  revalidatePath("/home");
  if(isObCompetition(competitionId))scheduleObResultsPublish();
}
async function call(name: "mutate_competition_meet" | "check_competition_meet_mutation" | "save_competition_relay_checked", args: {p_competition_id:string;p_request_id:string;p_command:Json}) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if(error)return {data:null,error:{message:"meet_auth_unavailable"}};
  if (!data.user || await isMemberPreviewActive()) return { data: null, error: { message: "meet_forbidden" } };
  return client.rpc(name,args);
}
function message(error: string) {
  if(error.includes("meet_auth_unavailable"))return "本人情報を確認できませんでした。接続してからもう一度操作してください";
  if(error.includes("meet_duty_confirmation"))return "この時間に補助担当があります。担当を保持して出場を登録するか確認してください";
  if (error.includes("meet_backend_changed")) return "接続が変わりました。画面を開き直してから操作してください";
  if (error.includes("meet_pending")) return "大会データの切替準備中です。現在のプログラムから操作してください";
  if (error.includes("meet_conflict")) return "ほかの操作で更新されています。最新の情報を読み込み、変更を確認してください";
  if (error.includes("meet_forbidden")) return "この操作の権限がありません";
  if (error.includes("meet_confirmed")) return "結果が確定しています。確定を解除してから変更してください";
  if (error.includes("meet_division")) return "同じ種目の男子・女子を選んでください。別の種目には変更できません";
  if (error.includes("meet_relay_team")) return "リレーは種目の画面からチーム名とタイムを入力してください";
  if (error.includes("meet_relay_invalid")) return "各レーンのチーム名とタイムを確認してください";
  if (error.includes("meet_position")) return "その組・番号は使用中です。空いている番号を選んでください";
  if (error.includes("meet_duties")) return "出場や担当と重複するか、役割が使用中です。補助担当を確認してください";
  if (error.includes("meet_profile")) return "このアカウントの参加者は登録済みです。既存の参加者を選んでください";
  if (error.includes("meet_unavailable")) return "取消・削除・欠席中です。先に復帰操作を行ってください";
  return "保存できませんでした。入力を確認してください";
}
export async function mutateCompetitionMeet(competitionId: string, requestId: string, command: MeetCommand): Promise<MeetMutationResult> {
  if (!competitionKey.test(competitionId) || !uuid.test(requestId) || !command || JSON.stringify(command).length > 250000) return { ok: false, message: "入力を確認してください" };
  try {
    const result = await call(command.action==="relay.save"?"save_competition_relay_checked":"mutate_competition_meet", { p_competition_id: competitionId, p_request_id: requestId, p_command: command as unknown as Json });
    if (result.error) return (/^meet_|^duplicate|^invalid/.test(result.error.message)||("code" in result.error&&["42501","P0001","23505","23514","23503","22P02"].includes(String(result.error.code)))) ? { ok: false, stale: result.error.message.includes("meet_conflict"), message: message(result.error.message) } : {ok:false,uncertain:true,message:"保存結果を確認できませんでした。入力は残っています。結果を確認してください"};
    if(!result.data||typeof result.data!=="object"||Array.isArray(result.data)||result.data.requestId!==requestId)return {ok:false,uncertain:true,message:"保存結果を確認できませんでした。入力は残っています。結果を確認してください"};
    refresh(competitionId);
    return { ok: true, requestId, ...(result.data && typeof result.data === "object" && !Array.isArray(result.data) && typeof result.data.id === "string" ? { id: result.data.id } : {}) };
  } catch { return { ok: false, uncertain: true, message: "保存結果を確認できませんでした。入力は残っています。接続後に結果を確認してください" }; }
}
export async function checkCompetitionMeetMutation(competitionId: string, requestId: string, command: MeetCommand): Promise<MeetMutationResult> {
  if (!competitionKey.test(competitionId) || !uuid.test(requestId) || !command || JSON.stringify(command).length > 250000) return { ok: false, message: "入力を確認してください" };
  try {
    const result = await call("check_competition_meet_mutation", { p_competition_id: competitionId, p_request_id: requestId, p_command: command as unknown as Json });
    if (result.error || !result.data) return { ok: false, uncertain: true, message: "保存結果を確認できませんでした。接続後にもう一度結果を確認してください" };
    if(typeof result.data==="object"&&!Array.isArray(result.data)&&result.data.notSaved===true)return {ok:false,notSaved:true,uncertain:true,message:"この操作はまだ保存されていません。同じ操作を確認して再送できます"};
    if(typeof result.data!=="object"||Array.isArray(result.data)||result.data.requestId!==requestId)return {ok:false,uncertain:true,message:"保存結果を照合できませんでした。入力は残っています"};
    refresh(competitionId);
    return { ok: true, requestId, ...(typeof result.data==="object"&&!Array.isArray(result.data)&&typeof result.data.id==="string"?{id:result.data.id}:{}) };
  } catch { return { ok: false, uncertain: true, message: "保存結果を確認できませんでした。入力は残っています" }; }
}

export async function readCompetitionMeetHistory(competitionId:string,cursor:{id:string;time:string}|null):Promise<{id:string;time:string;actor:string;target:string;action:string}[]> {
  const client=await createClient(),{data:user,error}=await client.auth.getUser();
  if(error)throw new Error("変更履歴を取得できませんでした");
  if(!user.user||await isMemberPreviewActive())throw new Error("権限がありません");
  const result=await client.rpc("get_competition_meet_history",{p_competition_id:competitionId,p_cursor:cursor});
  if(result.error||!Array.isArray(result.data))throw new Error("変更履歴を取得できませんでした");
  return result.data as unknown as {id:string;time:string;actor:string;target:string;action:string}[];
}
