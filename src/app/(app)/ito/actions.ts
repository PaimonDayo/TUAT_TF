"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getAllProfiles } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { ITO_DELETABLE_STATUSES, itoInviteTargets, validateItoGameForm } from "@/lib/ito-entry";
import type { ItoGameFormValues } from "@/lib/ito-entry";
import type { ItoGame } from "@/types";

/**
 * ito の進行操作。ゲーム作成・エントリー受付はシステム管理者だけが行う。
 * RLS でも can_manage_system() を要求しているが、ここでも先に弾いて
 * 分かりやすいエラーにする（UIガードと合わせて二重に守る）。
 */

async function requireItoAdmin() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) {
    throw new Error("システム管理者だけが操作できます");
  }
  return profile;
}

export async function createItoGame(values: ItoGameFormValues): Promise<ItoGame> {
  const profile = await requireItoAdmin();
  const errors = validateItoGameForm(values);
  if (errors.length > 0) throw new Error(errors[0].message);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ito_games")
    .insert({
      name: values.name.trim(),
      target_role_id: values.targetRoleId,
      group_count: values.groupCount,
      max_group_size: values.maxGroupSize,
      status: "draft",
      created_by: profile.id,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error("ゲームを作成できませんでした");
  }
  revalidatePath("/ito/admin");
  return data as ItoGame;
}

export async function updateItoGame(
  gameId: string,
  values: ItoGameFormValues,
): Promise<void> {
  await requireItoAdmin();
  const errors = validateItoGameForm(values);
  if (errors.length > 0) throw new Error(errors[0].message);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ito_games")
    .update({
      name: values.name.trim(),
      target_role_id: values.targetRoleId,
      group_count: values.groupCount,
      max_group_size: values.maxGroupSize,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId)
    // 設定を変えられるのは作成直後だけ。エントリー開始後は触らせない。
    .eq("status", "draft")
    .select("id");

  if (error) throw new Error("ゲームを更新できませんでした");
  if (!data || data.length === 0) {
    throw new Error("エントリー開始後は設定を変更できません");
  }
  revalidatePath("/ito/admin");
}

/**
 * ゲームを削除する。終了済みのゲームは、ラウンド・グループ・秘密数字・
 * 回答・得点履歴も一緒に消える（外部キーの ON DELETE CASCADE）ため、
 * 呼び出し側で必ず確認を取ること。
 */
export async function deleteItoGame(gameId: string): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ito_games")
    .delete()
    .eq("id", gameId)
    .in("status", ITO_DELETABLE_STATUSES)
    .select("id");
  if (error) throw new Error("ゲームを削除できませんでした");
  if (!data || data.length === 0) {
    throw new Error("進行中のゲームは、終了してから削除してください");
  }
  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

/**
 * 対象ロールの部員へ招待を送る。招待行は追記だけで、過去の回答は書き換えない。
 * 同じラウンドで招待済みの人は重複させない（再招待は次のラウンド番号で行う）。
 */
export async function inviteItoMembers(
  gameId: string,
  roundNo: number,
): Promise<number> {
  const profile = await requireItoAdmin();
  const supabase = await createClient();

  const { data: game } = await supabase
    .from("ito_games")
    .select("*")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) throw new Error("ゲームが見つかりません");
  if (!game.target_role_id) throw new Error("参加対象のロールが設定されていません");

  const [members, { data: existing }] = await Promise.all([
    getAllProfiles(),
    supabase
      .from("ito_invitations")
      .select("profile_id")
      .eq("game_id", gameId)
      .eq("round_no", roundNo),
  ]);

  const targets = itoInviteTargets({
    candidates: members.filter((member) => member.status === "active"),
    targetRoleId: game.target_role_id,
    alreadyInvitedIds: (existing ?? []).map((row) => row.profile_id),
  });
  if (targets.length === 0) return 0;

  const { error } = await supabase.from("ito_invitations").insert(
    targets.map((target) => ({
      game_id: gameId,
      profile_id: target.id,
      round_no: roundNo,
      invited_by: profile.id,
    })),
  );
  if (error) throw new Error("招待を送れませんでした");

  revalidatePath("/ito/admin");
  return targets.length;
}

/** エントリー受付を開始し、対象ロールの部員へ招待を送る。 */
export async function openItoEntry(gameId: string): Promise<number> {
  await requireItoAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ito_games")
    .update({ status: "entry", updated_at: new Date().toISOString() })
    .eq("id", gameId)
    .eq("status", "draft")
    .select("id");
  if (error) throw new Error("エントリーを開始できませんでした");
  if (!data || data.length === 0) {
    throw new Error("このゲームはすでにエントリーを開始しています");
  }

  return inviteItoMembers(gameId, 1);
}

/**
 * エントリー受付を終了する。
 * 未回答は declined に書き換えず pending のまま残し、そのラウンドの対象から外すだけ。
 */
export async function closeItoEntry(gameId: string): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ito_games")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", gameId)
    .eq("status", "entry")
    .select("id");
  if (error) throw new Error("エントリーを締め切れませんでした");
  if (!data || data.length === 0) {
    throw new Error("エントリー受付中のゲームではありません");
  }
  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

export async function finishItoGame(gameId: string): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ito_games")
    .update({ status: "finished", updated_at: new Date().toISOString() })
    .eq("id", gameId)
    .eq("status", "active")
    .select("id");
  if (error) throw new Error("ゲームを終了できませんでした");
  if (!data || data.length === 0) {
    throw new Error("進行中のゲームではありません");
  }
  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

/** 招待への回答。本人確認とフェーズ確認は RPC 側で行う。 */
export async function respondItoInvitation(
  invitationId: string,
  accept: boolean,
): Promise<void> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("ito_respond_invitation", {
    invitation_id: invitationId,
    accept,
  });
  if (error) {
    throw new Error(
      error.message.includes("already answered")
        ? "この招待にはすでに回答しています"
        : "回答を保存できませんでした",
    );
  }
  revalidatePath("/ito");
  revalidatePath("/ito/admin");
}
