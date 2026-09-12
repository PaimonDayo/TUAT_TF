// 毎時同期の本体。上のモジュールを順に呼ぶ進行役。

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordFieldDef } from "@/types";
import { relevantSheetHeaderSignature } from "@/lib/sheet-field-config";
import { sheetContentSignature } from "@/lib/sheet-public-csv";
import type { SyncOptions, SyncResult } from "./types";
import { SHEET_HISTORY_START, todayJST, sheetPullCutoff } from "./dates";
import { resolveFieldMap, appToCellsFull, appToCellsNonEmpty } from "./field-map";
import type { DbRecord } from "./field-map";
import { gasPost, fetchAllRaw } from "./gas-client";
import { sheetRecordsWithoutPendingPushes, computeMemberPull } from "./pull";
import { reconcileSheetReplies } from "./replies";

// ── 同期本体 ─────────────────────────────────────────────────────────────────
// 安全方針(docs/SHEETS-SYNC-PLAN.md・事故対策):
//  - カットオフ(2026-06-22)以前・未来日・空の行は同期しない
//  - シート連携者: 確認済みの列は空欄も反映。未マップ列とシートに存在しない日は触らない
//  - 同日に複数記録がある日付は曖昧なのでスキップ（conflictとして報告）
//  - dryRun で「何が起きるか」だけ確認できる
export async function runSheetSync(
  admin: SupabaseClient,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const dryRun = !!options.dryRun;
  const result: SyncResult = {
    inserted: 0,
    updated: 0,
    pushed: 0,
    conflicts: [],
    skippedMembers: [],
    unchangedMembers: [],
    failedMembers: [],
    sheetReplies: 0,
    dryRun,
  };
  const today = todayJST();
  const inRange = (d: string) => d >= SHEET_HISTORY_START && d <= today;

  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields, record_source, sheet_linked_at, sheet_header_signature, sheet_history_imported_at")
    .not("sheet_name", "is", null);
  if (pErr) throw pErr;

  let linked = (profiles ?? []).filter((p) => p.sheet_name) as {
    id: string;
    sheet_name: string;
    record_fields: RecordFieldDef[] | null;
    record_source: "app" | "sheet";
    sheet_linked_at: string | null;
    sheet_header_signature: string | null;
    sheet_history_imported_at: string | null;
  }[];
  if (options.onlySheet) {
    linked = linked.filter((p) => p.sheet_name.trim() === options.onlySheet!.trim());
  }
  if (options.onlySheets) {
    const allowed = new Set(options.onlySheets.map((name) => name.trim()));
    linked = linked.filter((profile) => allowed.has(profile.sheet_name.trim()));
  }
  if (linked.length === 0) return result;

  const nameById = new Map(linked.map((p) => [p.id, p.sheet_name.trim()]));
  const allUserIds = linked.map((profile) => profile.id);
  const [{ data: syncStates, error: stateError }, { data: pendingRows, error: pendingError }] = await Promise.all([
    admin
      .from("sheet_member_sync_state")
      .select("profile_id, content_signature, config_signature")
      .in("profile_id", allUserIds),
    admin
      .from("practice_records")
      .select("user_id")
      .in("user_id", allUserIds)
      .eq("pending_sheet_push", true),
  ]);
  if (stateError) throw stateError;
  if (pendingError) throw pendingError;
  const signatureByProfile = new Map((syncStates ?? []).map((state) => [state.profile_id, state.content_signature]));
  const configSignatureByProfile = new Map((syncStates ?? []).map((state) => [state.profile_id, state.config_signature]));
  const profilesWithPendingPush = new Set((pendingRows ?? []).map((row) => row.user_id));
  const currentConfigSignatures = new Map(linked.map((profile) => [
    profile.id,
    sheetContentSignature(JSON.stringify({
      fields: profile.record_fields,
      header: profile.sheet_header_signature,
      source: profile.record_source,
    })),
  ]));

  const fetched = await fetchAllRaw(linked.map((profile) => ({
    name: profile.sheet_name,
    previousSignature: signatureByProfile.get(profile.id) ?? null,
    forceParse: profilesWithPendingPush.has(profile.id)
      || configSignatureByProfile.get(profile.id) !== currentConfigSignatures.get(profile.id),
  })));
  result.failedMembers.push(...fetched.failedMembers);
  result.unchangedMembers.push(...fetched.unchangedMembers);
  const members = fetched.members;
  const memberByName = new Map(members.map((m) => [m.name.trim(), m]));
  const processedProfiles = linked.filter((profile) => memberByName.has(profile.sheet_name.trim()));
  const sheetToProfile = new Map(processedProfiles.map((profile) => [profile.sheet_name.trim(), profile]));

  const userIds = processedProfiles.map((profile) => profile.id);
  if (userIds.length === 0) return result;
  const { data: existing, error: rErr } = await admin
    .from("practice_records")
    .select(
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, dist_actual, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at, pending_sheet_push",
    )
    .in("user_id", userIds)
    .gte("recorded_date", SHEET_HISTORY_START);
  if (rErr) throw rErr;

  // user_id -> date -> 記録の配列（複数/日を検出するため配列で持つ）
  const byUser = new Map<string, Map<string, DbRecord[]>>();
  for (const uid of userIds) byUser.set(uid, new Map());
  for (const r of (existing ?? []) as DbRecord[]) {
    const m = byUser.get(r.user_id)!;
    const arr = m.get(r.recorded_date) ?? [];
    arr.push(r);
    m.set(r.recorded_date, arr);
  }

  const nowIso = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; profileId: string; patch: Record<string, unknown> }[] = [];
  const pushes: {
    id: string;
    memberName: string;
    date: string;
    cells: Record<string, string | number>;
    /** write-through再送分か（成功時にpending_sheet_pushをfalseへ戻す対象） */
    clearsPending?: boolean;
  }[] = [];
  const historyImportCandidates = new Set<string>();
  const historyImportFailures = new Set<string>();

  for (const [sheetName, profile] of sheetToProfile) {
    const member = memberByName.get(sheetName);
    if (!member) {
      result.skippedMembers.push(sheetName);
      continue;
    }
    const profileFields = profile.record_fields ?? [];
    const currentHeaderSignature = relevantSheetHeaderSignature(
      member.columns ?? member.header.map((label, index) => ({ index, label })),
      profileFields,
      profileFields.some((field) => field.key.startsWith("dist_")),
    );
    const stagedSheetFlow = Boolean(profile.sheet_header_signature);
    if (stagedSheetFlow && profile.sheet_header_signature && profile.sheet_header_signature !== currentHeaderSignature) {
      result.skippedMembers.push(sheetName);
      result.failedMembers.push({ member: sheetName, reason: "見出しが変更されています。アプリで入力項目を再確認してください" });
      continue;
    }
    const map = resolveFieldMap(member, profile.record_fields ?? []);
    const appByDate = byUser.get(profile.id)!;

    if (profile.record_source === "sheet") {
      const pendingPushDates = new Set<string>();
      // write-through保存がGAS側の一時失敗等で未反映のまま残っている記録があれば、
      // pullで（古いシート値により）巻き戻される前に非破壊で再送する（タスク16の安全網）。
      // 判定は専用フラグ pending_sheet_push のみを見る（updated_at/synced_atの大小比較=appIsNewer
      // は使わない。write-through導入前からの無関係な時刻ズレまで再送対象と誤検知し、
      // 部員がスプシへ直接入力した内容を古いアプリ値で上書きしかねないことがdry-runで判明したため）。
      for (const [date, list] of appByDate) {
        if (!inRange(date) || list.length !== 1) continue;
        const app = list[0];
        if (!app.pending_sheet_push) continue;
        pendingPushDates.add(date);
        const cells = appToCellsNonEmpty(map, app);
        if (Object.keys(cells).length > 0) {
          pushes.push({ id: app.id, memberName: sheetName, date, cells, clearsPending: true });
        }
      }

      // pullのみ: シートを正としてアプリへ反映。シートに行が無い日は触らない。
      // 初回はシート開始日から全履歴を補完し、完了後は直近1か月だけを再取得する。
      const cutoff = sheetPullCutoff(today, profile.sheet_history_imported_at);
      if (!profile.sheet_history_imported_at) historyImportCandidates.add(profile.id);
      const inRangeForProfile = (d: string) => d >= cutoff && d <= today;
      const pulled = computeMemberPull(
        profile.id,
        map,
        sheetRecordsWithoutPendingPushes(member.records, pendingPushDates),
        appByDate,
        inRangeForProfile,
        nowIso,
        stagedSheetFlow ? "replace_mapped" : "merge_nonempty",
      );
      inserts.push(...pulled.inserts);
      updates.push(...pulled.updates.map((update) => ({ ...update, profileId: profile.id })));
      result.inserted += pulled.inserts.length;
      result.updated += pulled.updates.length;
      for (const d of pulled.conflicts) result.conflicts.push(`${sheetName} ${d}`); // 複数/日は触らない
      if (pulled.conflicts.length > 0) historyImportFailures.add(profile.id);
    } else {
      // App-main: retry failed pushes, then import only dates missing from the DB.
      const pendingPushDates = new Set<string>();
      // updated_at はいいね数等の同期対象外更新でも変わり得るため、再送判定には使わない。
      for (const [date, list] of appByDate) {
        if (!inRange(date) || list.length !== 1) continue; // 複数/日は触らない
        const app = list[0];
        if (!app.pending_sheet_push) continue;
        pendingPushDates.add(date);
        const cells = appToCellsFull(map, app);
        if (Object.keys(cells).length > 0) {
          pushes.push({ id: app.id, memberName: sheetName, date, cells, clearsPending: true });
        }
      }

      // Non-empty sheet edits win after pending app pushes are safely excluded.
      const cutoff = sheetPullCutoff(today, profile.sheet_history_imported_at);
      if (!profile.sheet_history_imported_at) historyImportCandidates.add(profile.id);
      const pulled = computeMemberPull(
        profile.id,
        map,
        sheetRecordsWithoutPendingPushes(member.records, pendingPushDates),
        appByDate,
        (date) => date >= cutoff && date <= today,
        nowIso,
        "merge_nonempty",
      );
      inserts.push(...pulled.inserts);
      result.inserted += pulled.inserts.length;
      for (const date of pulled.conflicts) result.conflicts.push(`${sheetName} ${date}`);
      if (pulled.conflicts.length > 0) historyImportFailures.add(profile.id);
    }
  }

  const configuredPushLimit = Number.parseInt(process.env.SHEET_SYNC_PUSH_LIMIT ?? "25", 10);
  const pushLimit = Number.isFinite(configuredPushLimit)
    ? Math.min(100, Math.max(1, configuredPushLimit))
    : 25;
  const scheduledPushes = pushes.slice(0, pushLimit);

  if (dryRun) {
    result.inserted = inserts.length;
    result.updated = updates.length;
    result.pushed = scheduledPushes.length;
    try {
      const replySync = await reconcileSheetReplies(
        admin,
        processedProfiles.map((profile) => ({ id: profile.id, sheet_name: profile.sheet_name })),
        members,
        sheetPullCutoff(today, nowIso),
        today,
        true,
      );
      result.sheetReplies = replySync.synced;
      result.failedMembers.push(...replySync.failedMembers);
    } catch (error) {
      result.failedMembers.push({
        member: "(スプレッドシートの返信)",
        reason: error instanceof Error ? error.message : "返信の状態を確認できませんでした",
      });
    }
    return result;
  }

  // 部分失敗設計: 1件（1部員）の失敗で他の部員の同期を止めない
  // （2026-07-02〜03、1人のシート不調で28時間全滅した事故の再発防止）。
  if (inserts.length > 0) {
    const { error } = await admin.from("practice_records").insert(inserts);
    if (error) {
      result.inserted = 0;
      // 一括insertが失敗したら1件ずつ入れ直し、不正な行だけをスキップする。
      // 失敗した部員は履歴取込完了にせず、次回も全期間を再確認する。
      // （1セルの型不一致で全部員の新規取込が止まった事故の再発防止。）
      for (const row of inserts) {
        const { error: rowErr } = await admin.from("practice_records").insert(row);
        if (rowErr) {
          result.failedMembers.push({
            member: nameById.get(row.user_id as string) ?? String(row.user_id),
            reason: `${row.recorded_date}: ${rowErr.message}`,
          });
          historyImportFailures.add(row.user_id as string);
        } else {
          result.inserted++;
        }
      }
    }
  }
  for (const u of updates) {
    try {
      const { error } = await admin.from("practice_records").update(u.patch).eq("id", u.id);
      if (error) throw error;
    } catch (err) {
      result.updated--;
      result.failedMembers.push({
        member: nameById.get(u.profileId) ?? "(取込更新)",
        reason: err instanceof Error ? err.message : "更新できませんでした",
      });
      historyImportFailures.add(u.profileId);
    }
  }

  for (const profileId of historyImportCandidates) {
    if (historyImportFailures.has(profileId)) continue;
    const { error } = await admin
      .from("profiles")
      .update({ sheet_history_imported_at: nowIso })
      .eq("id", profileId)
      .is("sheet_history_imported_at", null);
    if (error) {
      result.failedMembers.push({
        member: nameById.get(profileId) ?? profileId,
        reason: `履歴取込の完了を保存できませんでした: ${error.message}`,
      });
    }
  }

  try {
    const replySync = await reconcileSheetReplies(
      admin,
      processedProfiles.map((profile) => ({ id: profile.id, sheet_name: profile.sheet_name })),
      members,
      sheetPullCutoff(today, nowIso),
      today,
    );
    result.sheetReplies = replySync.synced;
    result.failedMembers.push(...replySync.failedMembers);
  } catch (error) {
    result.failedMembers.push({
      member: "(スプレッドシートの返信)",
      reason: error instanceof Error ? error.message : "返信を書き込めませんでした",
    });
  }

  for (const p of scheduledPushes) {
    try {
      await gasPost({ action: "writeCells", memberName: p.memberName, date: p.date, cells: p.cells });
      const { error } = await admin
        .from("practice_records")
        .update({
          synced_at: new Date().toISOString(),
          ...(p.clearsPending ? { pending_sheet_push: false } : {}),
        })
        .eq("id", p.id);
      if (error) throw error;
      result.pushed++;
    } catch (err) {
      result.failedMembers.push({
        member: p.memberName,
        reason: err instanceof Error ? err.message : "スプレッドシートに書き込めませんでした",
      });
    }
  }

  // CSV取得後にアプリからシートへ書いた部員は、取得時点のハッシュが直後に古くなる。
  // それ以外の正常完了分だけ保存し、次回は本文が同じならCSV解析とDB突合を丸ごと省略する。
  const failedNames = new Set(result.failedMembers.map((failure) => failure.member));
  const hasGlobalFailure = [...failedNames].some((name) => name.startsWith("("));
  const pushedNames = new Set(scheduledPushes.map((push) => push.memberName));
  const signatureRows = hasGlobalFailure ? [] : processedProfiles.flatMap((profile) => {
    const name = profile.sheet_name.trim();
    const signature = fetched.signatures.get(name);
    const conflicted = result.conflicts.some((conflict) => conflict.startsWith(`${name} `));
    if (!signature || failedNames.has(name) || pushedNames.has(name) || conflicted) return [];
    return [{
      profile_id: profile.id,
      content_signature: signature,
      config_signature: currentConfigSignatures.get(profile.id)!,
      synced_at: nowIso,
    }];
  });
  if (signatureRows.length > 0) {
    const { error } = await admin
      .from("sheet_member_sync_state")
      .upsert(signatureRows, { onConflict: "profile_id" });
    if (error) {
      result.failedMembers.push({
        member: "(差分取得状態)",
        reason: `次回用のCSV署名を保存できませんでした: ${error.message}`,
      });
    }
  }

  return result;
}
