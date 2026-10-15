import { BLOCKS } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import { recordFieldsFromJson } from "@/lib/profile-normalize";
import { sheetLinkStatus, type SheetLinkStatus } from "@/lib/sheet-input-mode";
import { needsSheetSetupConfirmation, parseSheetTransition } from "@/lib/sheet-period";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Block, Profile, RecordFieldDef } from "@/types";
import type { Database, Json } from "@/types/database";

type MemberSheetMetadata = Pick<
  Profile,
  "id" | "display_name" | "avatar_url" | "blocks" | "grade" | "status"
>;

export type MemberSheetSettings = MemberSheetMetadata & {
  link_status: Exclude<SheetLinkStatus, "ended">;
};

export type SheetSettingsPeriod = {
  id: "october" | "legacy";
  label: string;
  sheet_name: string | null;
  mode: "sheet" | "app_only" | "off" | null;
  link_status: SheetLinkStatus;
  fields: RecordFieldDef[];
  editable: boolean;
};

export type MemberSheetSettingsDetail = MemberSheetSettings & {
  periods: SheetSettingsPeriod[];
};

const PAGE_SIZE = 500;
const MEMBER_COLUMNS = "id, display_name, avatar_url, blocks, grade, status, sheet_name, transition_version:sheet_transition->>version, transition_mode:sheet_transition->>mode, transition_confirmed_at:sheet_transition->>confirmed_at";

function memberMetadata(
  member: Pick<Database["public"]["Tables"]["profiles"]["Row"], keyof MemberSheetMetadata>,
): MemberSheetMetadata {
  return {
    id: member.id,
    display_name: member.display_name,
    avatar_url: member.avatar_url,
    blocks: member.blocks.filter((block): block is Block => Object.hasOwn(BLOCKS, block)),
    grade: member.grade,
    status: member.status === "graduated" ? "graduated" : "active",
  };
}

/** システム管理者向けの部員一覧。個人の設定は詳細を開いたときだけ取得する。 */
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
      .select(MEMBER_COLUMNS)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || data === null) {
      throw new Error("部員のスプレッドシート設定を取得できませんでした");
    }

    members.push(...data.map((member) => ({
      ...memberMetadata(member),
      link_status: sheetLinkStatus({
        version: member.transition_version,
        mode: member.transition_mode,
        confirmed_at: member.transition_confirmed_at,
        sheet_name: member.sheet_name,
      }),
    })));
    if (data.length < PAGE_SIZE) return members;
  }
}

/** 現在と過去の表示設定を分けて取得する。記録本文や設定履歴の生JSONは返さない。 */
export async function getMemberSheetSettingsById(id: string): Promise<MemberSheetSettingsDetail | null> {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) {
    throw new Error("システム管理権限が必要です");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, blocks, grade, status, sheet_name, record_source, record_fields, sheet_transition")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("部員のスプレッドシート設定を取得できませんでした");
  if (data === null) return null;

  const transition = parseSheetTransition(data.sheet_transition);
  const currentConfig = data.sheet_transition && typeof data.sheet_transition === "object" && !Array.isArray(data.sheet_transition)
    ? data.sheet_transition : null;
  const linkStatus = sheetLinkStatus({
    version: currentConfig?.version,
    mode: currentConfig?.mode,
    confirmed_at: currentConfig?.confirmed_at,
    sheet_name: data.sheet_name,
  });
  const legacy = transition?.legacy;
  const legacyFields = legacy ? legacy.record_fields as unknown as Json : data.record_fields;
  const legacySource = legacy ? legacy.record_source : data.record_source;

  return {
    ...memberMetadata(data),
    link_status: linkStatus,
    periods: [
      {
        id: "october",
        label: "2026年10月1日以降",
        sheet_name: transition ? data.sheet_name : null,
        mode: transition?.mode ?? null,
        link_status: linkStatus,
        fields: transition ? recordFieldsFromJson(data.record_fields) : [],
        editable: !!(transition && transition.mode !== "off" && data.sheet_name && !needsSheetSetupConfirmation(transition)),
      },
      {
        id: "legacy",
        label: "2026年9月30日以前（連携終了）",
        sheet_name: legacy
          ? typeof legacy.sheet_name === "string" ? legacy.sheet_name : null
          : data.sheet_name,
        mode: legacySource === "sheet" ? "sheet" : "app_only",
        link_status: "ended",
        fields: recordFieldsFromJson(legacyFields),
        editable: false,
      },
    ],
  };
}
