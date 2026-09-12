// お知らせと個人通知の取得。

import { createClient } from "@/lib/supabase/server";
import { jstToday } from "@/lib/date";
import { normalizeNotificationRow } from "@/lib/query-normalize";
import type { Notice, NoticeWithReactions, AppNotificationWithActor } from "@/types";
import { isPresent, withNoticeReactions } from "./internal";

/** お知らせ一覧（直近200件。無期限の全件取得はしない） */
export async function getNotices(userId: string): Promise<NoticeWithReactions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  return withNoticeReactions(supabase, (data ?? []) as Notice[], userId);
}
/** ホーム: 重要は全件、通常は直近3件、明日締切は件数外で表示 */
export async function getHomeNotices(userId: string): Promise<NoticeWithReactions[]> {
  const supabase = await createClient();
  const today = jstToday();
  const tomorrow = jstToday(1);

  const [{ data: notices }, { data: dismissed }, { data: acknowledged }] = await Promise.all([
    supabase
      .from("notices")
      .select("*")
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order("created_at", { ascending: false }),
    supabase.from("notice_dismissals").select("notice_id").eq("user_id", userId),
    supabase.from("notice_reactions").select("notice_id").eq("user_id", userId).eq("reaction", "ack"),
  ]);

  const dismissedIds = new Set((dismissed ?? []).map((dismissal) => dismissal.notice_id as string));
  const acknowledgedIds = new Set((acknowledged ?? []).map((reaction) => reaction.notice_id as string));
  // 「確認」を付けたお知らせは重要指定を含めホームから除外する。
  const visible = ((notices ?? []) as Notice[]).filter(
    (notice) => !acknowledgedIds.has(notice.id) && (notice.pin_home || !dismissedIds.has(notice.id)),
  );
  const important = visible.filter((notice) => notice.pin_home);
  const reminders = visible.filter((notice) => notice.deadline === tomorrow);
  const recent = visible.filter((notice) => !notice.pin_home).slice(0, 3);
  const selected = new Map<string, Notice>();
  for (const notice of [...important, ...reminders, ...recent]) {
    selected.set(notice.id, notice);
  }
  const ordered = [...selected.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  return withNoticeReactions(supabase, ordered, userId);
}
/** 直近50件（無期限の全件取得はしない）。 */
export async function getPersonalNotifications(userId: string): Promise<AppNotificationWithActor[]> {
  const supabase = await createClient();
  const query = supabase
    .from("notifications")
    .select(`
      *,
      actor:profiles!actor_id(id, display_name, avatar_url)
    `)
    .eq("user_id", userId);
  const { data } = await query.order("created_at", { ascending: false }).limit(50);
  return (data ?? []).map(normalizeNotificationRow).filter(isPresent);
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const query = supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  const { count } = await query;
  return count ?? 0;
}
