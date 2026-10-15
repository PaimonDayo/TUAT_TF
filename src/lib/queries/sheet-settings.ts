import { BLOCKS } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import { recordFieldsFromJson } from "@/lib/profile-normalize";
import { parseSheetTransition } from "@/lib/sheet-period";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Block, Profile } from "@/types";

export type MemberSheetSettings = Pick<
  Profile,
  "id" | "display_name" | "blocks" | "grade" | "status" | "sheet_name" | "record_fields"
> & {
  sheet_transition: Pick<NonNullable<Profile["sheet_transition"]>, "mode"> | null;
};

const PAGE_SIZE = 500;

/** システム管理者向けの現在の表示設定。記録本文や過去の設定履歴は取得しない。 */
export async function getMemberSheetSettings(): Promise<MemberSheetSettings[]> {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) {
    throw new Error("システム管理権限が必要です");
  }

  const supabase = await createClient();
  const members: MemberSheetSettings[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, blocks, grade, status, sheet_name, sheet_transition, record_fields")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || data === null) {
      throw new Error("部員のスプレッドシート設定を取得できませんでした");
    }

    members.push(...data.map((member): MemberSheetSettings => {
      const transition = parseSheetTransition(member.sheet_transition);
      return {
        id: member.id,
        display_name: member.display_name,
        blocks: member.blocks.filter((block): block is Block => Object.hasOwn(BLOCKS, block)),
        grade: member.grade,
        status: member.status === "graduated" ? "graduated" : "active",
        sheet_name: member.sheet_name,
        sheet_transition: transition ? { mode: transition.mode } : null,
        record_fields: recordFieldsFromJson(member.record_fields),
      };
    }));
    if (data.length < PAGE_SIZE) return members;
  }
}
