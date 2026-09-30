// シート側の返信列とアプリのコメントの突き合わせ。

import type { SupabaseClient } from "@supabase/supabase-js";
import { importedSheetReplies, matchAppReplyIndexes, normalizeSheetReplyText, type AppReplyIndexCandidate, type RawSheetReply } from "@/lib/sheet-replies";
import { type RawMember } from "@/lib/sheet-public-csv";
import { gasPost } from "./gas-client";

export type ReplySyncProfile = {
  id: string;
  sheet_name: string;
};

export async function reconcileSheetReplies(
  supabase: SupabaseClient,
  profiles: ReplySyncProfile[],
  members: RawMember[],
  fromDate: string,
  throughDate: string,
  dryRun = false,
  spreadsheetId?: string,
): Promise<{
  synced: number;
  failedMembers: { member: string; reason: string }[];
}> {
  const memberByName = new Map(members.map((member) => [member.name.trim(), member]));
  const supportedProfiles = profiles.filter((profile) => {
    const member = memberByName.get(profile.sheet_name.trim());
    return member?.records.some((record) => Array.isArray(record.replies)) === true;
  });
  if (supportedProfiles.length === 0) return { synced: 0, failedMembers: [] };

  const profileIds = supportedProfiles.map((profile) => profile.id);
  const { data: records, error: recordError } = await supabase
    .from("practice_records")
    .select("id, user_id, recorded_date")
    .in("user_id", profileIds)
    .gte("recorded_date", fromDate)
    .lte("recorded_date", throughDate);
  if (recordError) throw recordError;

  const recordsByOwnerDate = new Map<string, { id: string }[]>();
  for (const record of records ?? []) {
    const key = record.user_id + ":" + record.recorded_date;
    const rows = recordsByOwnerDate.get(key) ?? [];
    rows.push({ id: record.id });
    recordsByOwnerDate.set(key, rows);
  }

  const { data: existingReplies, error: existingError } = await supabase
    .from("sheet_record_replies")
    .select("record_id, owner_id")
    .in("owner_id", profileIds)
    .gte("recorded_date", fromDate)
    .lte("recorded_date", throughDate);
  if (existingError) throw existingError;

  // Public CSV does not include cell notes. An app-origin reply must stay excluded
  // even after its app comment (and thus the text-based duplicate match) is gone.
  // Verify only members with current/recent replies, including removals. A failed
  // or malformed read must never become an empty replacement that deletes data.
  const failedMembers: { member: string; reason: string }[] = [];
  const candidates = supportedProfiles.filter(profile =>
    existingReplies?.some(reply => reply.owner_id === profile.id) ||
    memberByName.get(profile.sheet_name.trim())?.records.some(record =>
      record.date >= fromDate && record.date <= throughDate && record.replies?.length),
  );
  const verifiedMembers = new Map<string, RawMember>();
  const verificationDeadline = Date.now() + 60_000;
  for (let offset = 0; offset < candidates.length; offset += 4) {
    await Promise.all(candidates.slice(offset, offset + 4).map(async profile => {
      try {
        let response: { data?: RawMember } | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          const remaining = verificationDeadline - Date.now();
          if (remaining <= 0) throw new Error("Reply verification budget exceeded");
          try {
            response = await gasPost<{ data?: RawMember }>({
              action: "fetchMember", memberName: profile.sheet_name, spreadsheetId,
            }, AbortSignal.timeout(Math.min(20_000, remaining)));
            break;
          } catch (error) {
            // Only this read is retried. Never replay a reply write or deletion.
            if (attempt === 1) throw error;
          }
        }
        const member = response?.data;
        if (!member || member.name?.trim() !== profile.sheet_name.trim() || !Array.isArray(member.records) ||
          member.records.some(record => typeof record.date !== "string" ||
            !Array.isArray(record.replies) || record.replies.some(reply =>
              !Number.isInteger(reply.replyIndex) || reply.replyIndex < 0 ||
              typeof reply.content !== "string" || !["app", "sheet"].includes(reply.source)))) {
          throw new Error("Invalid reply source response");
        }
        verifiedMembers.set(profile.id, member);
      } catch {
        failedMembers.push({ member: profile.sheet_name.trim(), reason: "返信の送信元を確認できませんでした。既存の返信を保持し、次回同期で再確認します" });
      }
    }));
  }

  const rawRepliesByRecord = new Map<string, RawSheetReply[]>();
  const sheetNameByRecord = new Map<string, string>();
  for (const profile of supportedProfiles) {
    const member = verifiedMembers.get(profile.id);
    if (!member) continue;
    for (const sheetRecord of member.records) {
      if (sheetRecord.date < fromDate || sheetRecord.date > throughDate) continue;
      const matching = recordsByOwnerDate.get(profile.id + ":" + sheetRecord.date) ?? [];
      if (matching.length !== 1) continue;
      rawRepliesByRecord.set(matching[0].id, sheetRecord.replies ?? []);
      sheetNameByRecord.set(matching[0].id, profile.sheet_name);
    }
  }

  const targetIds = new Set(rawRepliesByRecord.keys());
  for (const reply of existingReplies ?? []) {
    if (verifiedMembers.has(reply.owner_id)) targetIds.add(reply.record_id);
  }
  if (targetIds.size === 0) return { synced: 0, failedMembers };

  const { data: appComments, error: commentError } = await supabase
    .from("comments")
    .select("id, target_id, content, created_at, sheet_reply_index, author:profiles!user_id(display_name)")
    .eq("target_type", "record")
    .in("target_id", [...targetIds]);
  if (commentError) throw commentError;

  const exportedByRecord = new Map<string, Set<string>>();
  const exportedIndexesByRecord = new Map<string, Set<number>>();
  const appRepliesByRecord = new Map<string, AppReplyIndexCandidate[]>();
  for (const comment of appComments ?? []) {
    const author = Array.isArray(comment.author) ? comment.author[0] : comment.author;
    const displayName = author?.display_name?.trim() ?? "";
    const exportedText = displayName ? `${comment.content}　${displayName}` : comment.content;
    const values = exportedByRecord.get(comment.target_id) ?? new Set<string>();
    values.add(normalizeSheetReplyText(exportedText));
    exportedByRecord.set(comment.target_id, values);
    if (comment.sheet_reply_index != null) {
      const indexes = exportedIndexesByRecord.get(comment.target_id) ?? new Set<number>();
      indexes.add(comment.sheet_reply_index);
      exportedIndexesByRecord.set(comment.target_id, indexes);
    }

    const candidates = appRepliesByRecord.get(comment.target_id) ?? [];
    candidates.push({
      id: comment.id,
      content: comment.content,
      authorName: displayName,
      createdAt: comment.created_at,
      sheetReplyIndex: comment.sheet_reply_index,
    });
    appRepliesByRecord.set(comment.target_id, candidates);
  }
  let synced = 0;
  for (const recordId of targetIds) {
    const rawReplies = rawRepliesByRecord.get(recordId) ?? [];
    const indexMatches = matchAppReplyIndexes(
      rawReplies,
      appRepliesByRecord.get(recordId) ?? [],
    );
    const rows = importedSheetReplies(
      rawReplies,
      exportedByRecord.get(recordId) ?? [],
      exportedIndexesByRecord.get(recordId) ?? [],
    );
    if (dryRun) {
      synced += indexMatches.length + rows.length;
      continue;
    }

    for (const match of indexMatches) {
      const { error: indexError } = await supabase
        .from("comments")
        .update({ sheet_reply_index: match.replyIndex })
        .eq("id", match.commentId);
      if (indexError) {
        failedMembers.push({
          member: sheetNameByRecord.get(recordId) ?? "(スプレッドシートの返信)",
          reason: "返信順の同期: " + indexError.message,
        });
      } else {
        synced++;
      }
    }
    const { error } = await supabase.rpc("replace_sheet_record_replies", {
      target_record_id: recordId,
      reply_rows: rows,
    });
    if (error) {
      failedMembers.push({
        member: sheetNameByRecord.get(recordId) ?? "(スプレッドシートの返信)",
        reason: "返信の同期: " + error.message,
      });
    } else {
      synced += rows.length;
    }
  }

  return { synced, failedMembers };
}
