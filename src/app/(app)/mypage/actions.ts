"use server";

import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUserRecords } from "@/lib/queries";
import type { PracticeRecord } from "@/types";

export async function loadMyTrainingRecords(): Promise<PracticeRecord[]> {
  const profile = await getCurrentProfile();
  return (await getUserRecords(profile.id)) as PracticeRecord[];
}
