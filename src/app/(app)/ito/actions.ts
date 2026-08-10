"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getAllProfiles } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import {
  ITO_DELETABLE_STATUSES,
  ITO_GAME_MIN_GROUP_SIZE,
  ITO_GAME_THEME_MAX,
  itoInviteTargets,
  validateItoGameForm,
} from "@/lib/ito-entry";
import { buildItoGroups, validateItoGrouping } from "@/lib/ito-grouping";
import { scoreItoRound as scoreItoRoundPure } from "@/lib/ito-score";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItoGameFormValues } from "@/lib/ito-entry";
import type { ItoGame, ItoGameMode, ItoPhase } from "@/types";

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
      mode: values.mode ?? "team",
      group_count: values.groupCount,
      max_group_size: values.maxGroupSize,
      theme: values.theme?.trim() || null,
      admin_participates: values.adminParticipates ?? false,
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
      mode: values.mode ?? "team",
      group_count: values.groupCount,
      max_group_size: values.maxGroupSize,
      theme: values.theme?.trim() || null,
      admin_participates: values.adminParticipates ?? false,
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
 * お題を設定・変更する。ゲームが終了していなければいつでも変更できる
 * （ラウンドごとにお題を変えたい運用を想定し、draft 限定にはしない）。
 */
export async function updateItoGameTheme(gameId: string, theme: string): Promise<void> {
  await requireItoAdmin();
  const trimmed = theme.trim();
  if (trimmed.length > ITO_GAME_THEME_MAX) {
    throw new Error(`テーマは${ITO_GAME_THEME_MAX}文字までにしてください。`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ito_games")
    .update({ theme: trimmed || null, updated_at: new Date().toISOString() })
    .eq("id", gameId)
    .neq("status", "finished")
    .select("id");

  if (error) throw new Error("テーマを設定できませんでした");
  if (!data || data.length === 0) {
    throw new Error("終了したゲームのテーマは変更できません");
  }
  revalidatePath("/ito/admin");
  revalidatePath("/ito");
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
    // 進行役の参加を選んだゲームは、作成者本人だけロール・管理権限に関わらず招待対象に含める。
    includeProfileIds: game.admin_participates && game.created_by ? [game.created_by] : [],
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

// ─────────────────────────────
// ラウンド進行（docs/ITO-PLAN.md §2.2）
// ─────────────────────────────

/** 通常グループの名前（A班・B班…）。26を超えたら AA班 のように続ける。 */
function groupName(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < letters.length
    ? `${letters[index]}班`
    : `${letters[Math.floor(index / letters.length) - 1]}${letters[index % letters.length]}班`;
}

/**
 * 次のラウンドを開始する。参加者をグループに分け、グループ編成フェーズまで作る。
 * 編成できない構成のときは理由を返して中止する。
 */
export async function startItoRound(gameId: string, keepGroups = false): Promise<string> {
  await requireItoAdmin();
  const supabase = await createClient();

  const { data: game } = await supabase
    .from("ito_games")
    .select("*")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) throw new Error("ゲームが見つかりません");
  if (game.status !== "active") {
    throw new Error("エントリーを締め切ってから開始してください");
  }

  const { data: rounds } = await supabase
    .from("ito_rounds")
    .select("*")
    .eq("game_id", gameId)
    .order("round_no", { ascending: true });
  const previous = rounds ?? [];
  if (previous.some((round) => round.phase !== "finished")) {
    throw new Error("進行中のラウンドがあります");
  }

  const { data: participants } = await supabase
    .from("ito_participants")
    .select("profile_id")
    .eq("game_id", gameId)
    .eq("status", "active");
  const participantIds = (participants ?? []).map((row) => row.profile_id);

  const mode = (game.mode ?? "team") as ItoGameMode;
  const errors = validateItoGrouping({
    participantCount: participantIds.length,
    groupCount: game.group_count,
    maxGroupSize: game.max_group_size,
    minGroupSize: ITO_GAME_MIN_GROUP_SIZE[mode],
  });
  if (errors.length > 0) throw new Error(errors.map((error) => error.message).join(" "));

  // 過去ラウンドの同席履歴（できるだけ同じ人と組まないようにするため）
  const history: string[][][] = [];
  if (previous.length > 0) {
    const { data: pastMembers } = await supabase
      .from("ito_group_members")
      .select("round_id, group_id, profile_id")
      .in("round_id", previous.map((round) => round.id));
    for (const round of previous) {
      const byGroup = new Map<string, string[]>();
      for (const member of pastMembers ?? []) {
        if (member.round_id !== round.id) continue;
        byGroup.set(member.group_id, [
          ...(byGroup.get(member.group_id) ?? []),
          member.profile_id,
        ]);
      }
      if (byGroup.size > 0) history.push([...byGroup.values()]);
    }
  }

  const lastRound = previous[previous.length - 1];
  let grouped: string[][];
  if (keepGroups && lastRound) {
    // 前ラウンドと同じ編成を保つ（今回いない人は外し、新しい人は少ない班へ）
    const { data: lastMembers } = await supabase
      .from("ito_group_members")
      .select("group_id, profile_id")
      .eq("round_id", lastRound.id);
    const byGroup = new Map<string, string[]>();
    for (const member of lastMembers ?? []) {
      if (!participantIds.includes(member.profile_id)) continue;
      byGroup.set(member.group_id, [
        ...(byGroup.get(member.group_id) ?? []),
        member.profile_id,
      ]);
    }
    grouped = [...byGroup.values()].filter((group) => group.length > 0);
    const placed = new Set(grouped.flat());
    for (const id of participantIds) {
      if (placed.has(id)) continue;
      const smallest = grouped.reduce(
        (min, group) => (group.length < min.length ? group : min),
        grouped[0],
      );
      if (smallest) smallest.push(id);
      else grouped.push([id]);
    }
  } else {
    grouped = buildItoGroups({
      participantIds,
      groupCount: game.group_count,
      maxGroupSize: game.max_group_size,
      minGroupSize: ITO_GAME_MIN_GROUP_SIZE[mode],
      history,
    });
  }

  const { data: round, error: roundError } = await supabase
    .from("ito_rounds")
    .insert({ game_id: gameId, round_no: previous.length + 1, phase: "grouping" })
    .select()
    .single();
  if (roundError || !round) throw new Error("ラウンドを作成できませんでした");

  const { data: groups, error: groupError } = await supabase
    .from("ito_groups")
    .insert([
      ...grouped.map((_, index) => ({
        round_id: round.id,
        name: groupName(index),
        is_leader_team: false,
        sort_order: index,
      })),
      {
        round_id: round.id,
        name: "代表者チーム",
        is_leader_team: true,
        sort_order: grouped.length,
      },
    ])
    .select();
  if (groupError || !groups) throw new Error("グループを作成できませんでした");

  const normalGroups = groups
    .filter((group) => !group.is_leader_team)
    .sort((a, b) => a.sort_order - b.sort_order);

  const { error: memberError } = await supabase.from("ito_group_members").insert(
    grouped.flatMap((ids, index) =>
      ids.map((profileId) => ({
        round_id: round.id,
        group_id: normalGroups[index].id,
        profile_id: profileId,
        is_leader: false,
      })),
    ),
  );
  if (memberError) throw new Error("グループの割り当てに失敗しました");

  revalidatePath("/ito/admin");
  revalidatePath("/ito");
  return round.id;
}

/** グループ編成をやり直す（編成フェーズのみ）。 */
export async function regenerateItoGroups(roundId: string): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();

  const { data: round } = await supabase
    .from("ito_rounds")
    .select("*")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) throw new Error("ラウンドが見つかりません");
  if (round.phase !== "grouping") throw new Error("編成できるのはグループ編成中だけです");

  const { data: game } = await supabase
    .from("ito_games")
    .select("*")
    .eq("id", round.game_id)
    .maybeSingle();
  if (!game) throw new Error("ゲームが見つかりません");

  const { data: members } = await supabase
    .from("ito_group_members")
    .select("profile_id")
    .eq("round_id", roundId);

  const grouped = buildItoGroups({
    participantIds: (members ?? []).map((member) => member.profile_id),
    groupCount: game.group_count,
    maxGroupSize: game.max_group_size,
    minGroupSize: ITO_GAME_MIN_GROUP_SIZE[(game.mode ?? "team") as ItoGameMode],
  });

  const { data: groups } = await supabase
    .from("ito_groups")
    .select("*")
    .eq("round_id", roundId)
    .eq("is_leader_team", false)
    .order("sort_order");
  if (!groups || groups.length === 0) throw new Error("グループが見つかりません");

  await supabase.from("ito_group_members").delete().eq("round_id", roundId);
  const { error } = await supabase.from("ito_group_members").insert(
    grouped.flatMap((ids, index) =>
      ids.map((profileId) => ({
        round_id: roundId,
        group_id: groups[Math.min(index, groups.length - 1)].id,
        profile_id: profileId,
        is_leader: false,
      })),
    ),
  );
  if (error) throw new Error("編成をやり直せませんでした");

  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

/** メンバーを別のグループへ移す（編成フェーズのみ）。 */
export async function moveItoMember(
  roundId: string,
  profileId: string,
  toGroupId: string,
): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();

  const { data: round } = await supabase
    .from("ito_rounds")
    .select("phase")
    .eq("id", roundId)
    .maybeSingle();
  if (round?.phase !== "grouping") throw new Error("移動できるのはグループ編成中だけです");

  const { error } = await supabase
    .from("ito_group_members")
    .update({ group_id: toGroupId, is_leader: false })
    .eq("round_id", roundId)
    .eq("profile_id", profileId);
  if (error) throw new Error("メンバーを移動できませんでした");

  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

/** 代表者の自由回答（「この数字なら○○さん」）を管理者が聞き取って入力する。 */
export async function setItoLeaderAnswer(
  roundId: string,
  profileId: string,
  answer: string,
): Promise<void> {
  const profile = await requireItoAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("ito_leader_answers").upsert(
    {
      round_id: roundId,
      profile_id: profileId,
      answer: answer.trim().slice(0, 100),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "round_id,profile_id" },
  );
  if (error) throw new Error("回答を保存できませんでした");
  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

/**
 * ラウンドのフェーズを進める。遷移の可否は DB 側（ito_advance_phase）が判定し、
 * ここではフェーズごとの付随処理（数字配布・回答枠の用意・採点）を行う。
 */
export async function advanceItoRound(roundId: string, toPhase: ItoPhase): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("ito_rounds")
    .select("*")
    .eq("id", roundId)
    .maybeSingle();
  if (!before) throw new Error("ラウンドが見つかりません");

  // 代表者受付を締め切る前に、全グループの代表者が決まっているか確認する。
  if (before.phase === "leader_select" && toPhase === "numbers") {
    const [{ data: groups }, { data: members }] = await Promise.all([
      supabase.from("ito_groups").select("id, name, is_leader_team").eq("round_id", roundId),
      supabase.from("ito_group_members").select("group_id, is_leader").eq("round_id", roundId),
    ]);
    const missing = (groups ?? [])
      .filter((group) => !group.is_leader_team)
      .filter(
        (group) =>
          !(members ?? []).some((member) => member.group_id === group.id && member.is_leader),
      );
    if (missing.length > 0) {
      throw new Error(
        `代表者が未定のグループがあります: ${missing.map((group) => group.name).join("、")}`,
      );
    }
  }

  const { error } = await supabase.rpc("ito_advance_phase", {
    target_round_id: roundId,
    to_phase: toPhase,
  });
  if (error) throw new Error(`フェーズを進められませんでした（${error.message}）`);

  if (toPhase === "numbers") {
    const { error: assignError } = await supabase.rpc("ito_assign_secrets", {
      target_round_id: roundId,
    });
    // 巻き戻して再度この画面に来た場合など、配布済みならそのまま進む。
    if (assignError && !assignError.message.includes("already assigned")) {
      throw new Error(`秘密数字を配れませんでした（${assignError.message}）`);
    }
  }

  if (toPhase === "ordering") {
    // 「未提出」を表示できるよう、空の回答枠を先に作っておく。
    const [{ data: groups }, { data: existing }] = await Promise.all([
      supabase.from("ito_groups").select("id").eq("round_id", roundId),
      supabase.from("ito_group_orders").select("group_id").eq("round_id", roundId),
    ]);
    const known = new Set((existing ?? []).map((row) => row.group_id));
    const missing = (groups ?? []).filter((group) => !known.has(group.id));
    if (missing.length > 0) {
      await supabase
        .from("ito_group_orders")
        .insert(
          missing.map((group) => ({ group_id: group.id, round_id: roundId, order_ids: [] })),
        );
    }
  }

  if (toPhase === "result") {
    await scoreItoRound(roundId);
  }

  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}

/**
 * ラウンドを採点して保存する。計算は純関数（ito-score）で行い、保存は
 * ito_apply_scores() が対象ラウンド分だけ入れ替える＝何度でも再採点できる。
 * 秘密数字の読み取りは、進行役自身が参加している場合でも採点できるよう
 * service role で行う（権限は requireItoAdmin で確認済み）。
 */
export async function scoreItoRound(roundId: string): Promise<void> {
  await requireItoAdmin();
  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: round }, { data: groups }, { data: members }, { data: orders }, { data: secrets }] =
    await Promise.all([
      supabase.from("ito_rounds").select("*").eq("id", roundId).maybeSingle(),
      supabase.from("ito_groups").select("*").eq("round_id", roundId),
      supabase.from("ito_group_members").select("*").eq("round_id", roundId),
      supabase.from("ito_group_orders").select("*").eq("round_id", roundId),
      admin.from("ito_secrets").select("*").eq("round_id", roundId),
    ]);
  if (!round) throw new Error("ラウンドが見つかりません");

  const result = scoreItoRoundPure({
    secrets: (secrets ?? []).map((secret) => ({
      profileId: secret.profile_id,
      number: secret.number,
    })),
    groups: (groups ?? []).map((group) => {
      const groupMembers = (members ?? []).filter((member) => member.group_id === group.id);
      return {
        groupId: group.id,
        isLeaderTeam: group.is_leader_team,
        leaderId: groupMembers.find((member) => member.is_leader)?.profile_id ?? null,
        memberIds: groupMembers.map((member) => member.profile_id),
        order: (orders ?? []).find((order) => order.group_id === group.id)?.order_ids ?? [],
      };
    }),
  });

  const { error } = await supabase.rpc("ito_apply_scores", {
    target_round_id: roundId,
    scores: result.scores.map((score) => ({
      group_id: score.groupId,
      correct_count: score.correctCount,
      points: score.points,
      is_perfect: score.isPerfect,
    })),
    points: result.points.map((point) => ({
      profile_id: point.profileId,
      points: point.points,
      source: point.source,
    })),
  });
  if (error) throw new Error(`採点結果を保存できませんでした（${error.message}）`);

  revalidatePath("/ito/admin");
  revalidatePath("/ito");
}
