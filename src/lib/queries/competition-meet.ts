import { createClient } from "@/lib/supabase/server";
import type { CompetitionMeet } from "@/lib/competition-meet";

export async function getCompetitionMeet(competitionId: string): Promise<CompetitionMeet | null> {
  const client = await createClient();
  const result = await client.rpc("get_competition_meet", { p_competition_id: competitionId });
  if (result.error) throw new Error("大会の運営情報を取得できませんでした");
  const snapshot=result.data;
  if(snapshot===null)return null;
  if(typeof snapshot!=="object"||Array.isArray(snapshot)||snapshot.competitionId!==competitionId||!["pc","cloud"].includes(String(snapshot.backend)))throw new Error("大会の運営情報を照合できませんでした");
  if(["participants","appearances","events","duties","roles","party","members"].some(key=>!Array.isArray(snapshot[key])))throw new Error("大会の運営情報を照合できませんでした");
  return result.data as unknown as CompetitionMeet | null;
}

export async function getCompetitionMeetBackend(): Promise<"pc" | "cloud"> {
  const client=await createClient();
  const result=await client.rpc("get_competition_meet_backend",{});
  if(result.error || !["pc","cloud"].includes(String(result.data)))throw new Error("保存先を確認できませんでした");
  return result.data as "pc"|"cloud";
}
