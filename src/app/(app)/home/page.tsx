import Link from "next/link";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock, ChevronRight, BookOpen } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HomeFeed } from "@/components/features/HomeFeed";
import { HomeNotices } from "@/components/features/HomeNotices";
import { InstallPrompt } from "@/components/features/InstallPrompt";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { getCurrentProfile } from "@/lib/supabase/auth";
import {
  getFeed,
  getUserRecords,
  getHomeNotices,
  getRecentSharedNotes,
  getAttendanceSchedules,
  getAttendancesForSchedules,
} from "@/lib/queries";
import { SCHEDULE_TYPES } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import { venueShort } from "@/lib/venues";
import type {
  PracticeRecord,
  PracticeSchedule,
  NoticeWithReactions,
  NoteWithRelations,
  AttendanceStatusOrNone,
} from "@/types";

export default async function HomePage() {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  // サーバーはUTCなので、日本時間の「今日」を基準にする（0時で日付が変わるように）
  const nowJst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const sevenDaysAgo = format(subDays(nowJst, 6), "yyyy-MM-dd");

  const [weekRecords, feed, notices, sharedNotes, attSchedules] = await Promise.all([
    getUserRecords(profile.id, sevenDaysAgo),
    getFeed(profile.id, "all", 3),
    getHomeNotices(profile.id),
    getRecentSharedNotes(3),
    getAttendanceSchedules(profile.blocks, perms.createSchedule, 3),
  ]);

  const schedules = attSchedules as PracticeSchedule[];
  const attRows = await getAttendancesForSchedules(schedules.map((s) => s.id));
  const myStatus = new Map<string, AttendanceStatusOrNone>();
  const presentCount = new Map<string, number>();
  const absentCount = new Map<string, number>();
  for (const r of attRows) {
    if (r.user_id === profile.id) myStatus.set(r.schedule_id, r.status);
    if (r.status === "present") presentCount.set(r.schedule_id, (presentCount.get(r.schedule_id) ?? 0) + 1);
    if (r.status === "absent") absentCount.set(r.schedule_id, (absentCount.get(r.schedule_id) ?? 0) + 1);
  }

  const weekKm = (weekRecords as PracticeRecord[]).reduce(
    (s, r) => s + (r.dist_low + r.dist_mid + r.dist_high + r.dist_speed),
    0,
  );
  const currentUser = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
  };

  return (
    <>
      <Header title="ホーム" large />

      <div className="px-4 space-y-5 pt-1">
        {/* PWA未起動の人へホーム画面追加を促す（自然に目に入るよう最上部に） */}
        <InstallPrompt />

        <p className="text-body text-muted">
          {format(nowJst, "M月d日 (E)", { locale: ja })}
        </p>

        {/* 重要なお知らせ */}
        <HomeNotices notices={notices as NoticeWithReactions[]} />

        {/* 直近7日間の統計 */}
        <section className="space-y-2">
          <p className="section-label">直近7日間のサマリー</p>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-caption">直近7日間の走行距離</p>
              <p className="text-large-title tabular-nums mt-1">
                {Math.round(weekKm * 10) / 10}
                <span className="text-body text-muted ml-1">km</span>
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-caption">直近7日間の練習回数</p>
              <p className="text-large-title tabular-nums mt-1">
                {weekRecords.length}
                <span className="text-body text-muted ml-1">回</span>
              </p>
            </Card>
          </div>
        </section>

        {/* 予定 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="section-label">予定</p>
            <Link href="/schedule" className="text-[13px] text-accent flex items-center">
              すべて見る <ChevronRight size={15} />
            </Link>
          </div>
          {schedules.length === 0 ? (
            <EmptyState title="対象の予定はありません" className="min-h-24 py-4" />
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => {
                const meta = SCHEDULE_TYPES[s.schedule_type];
                return (
                  <Card key={s.id} className="p-3 flex items-center gap-3">
                    {/* 日付・内容をタップすると予定タブで該当日のメニューを展開 */}
                    <Link
                      href={`/schedule?open=${s.id}`}
                      className="flex flex-1 items-center gap-3 min-w-0 active:opacity-60"
                    >
                      <div className="flex flex-col items-center w-10 shrink-0">
                        <span className="text-[10px]" style={{ color: meta.color }}>
                          {format(new Date(s.schedule_date + "T00:00:00"), "EEE", { locale: ja })}
                        </span>
                        <span className="text-xl font-bold leading-tight tabular-nums">
                          {format(new Date(s.schedule_date + "T00:00:00"), "d")}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Badge style={{ backgroundColor: meta.color + "1a", color: meta.color }}>
                            {meta.label}
                          </Badge>
                          <span className="text-[14px] font-semibold truncate">
                            {s.title ?? venueShort(s.venue_name) ?? meta.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-x-3 text-[12px] text-muted2 mt-0.5 min-w-0">
                          {s.meeting_time && (
                            <span className="flex items-center gap-1 shrink-0">
                              <Clock size={12} /> {s.meeting_time.slice(0, 5)}
                            </span>
                          )}
                          <span className="shrink-0 text-success">
                            出席{" "}
                            <span className="inline-block min-w-[2ch] text-right tabular-nums">
                              {presentCount.get(s.id) ?? 0}
                            </span>
                          </span>
                          <span className="shrink-0 text-danger">
                            欠席{" "}
                            <span className="inline-block min-w-[2ch] text-right tabular-nums">
                              {absentCount.get(s.id) ?? 0}
                            </span>
                          </span>
                        </div>
                      </div>
                    </Link>
                    <AttendanceToggle
                      scheduleId={s.id}
                      userId={profile.id}
                      initial={myStatus.get(s.id) ?? "none"}
                      refreshOnChange
                    />
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ノート */}
        {(sharedNotes as NoteWithRelations[]).length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="section-label">ノート</p>
              <Link href="/notes" className="text-[13px] text-accent flex items-center">
                すべて見る <ChevronRight size={15} />
              </Link>
            </div>
            <div className="space-y-2">
              {(sharedNotes as NoteWithRelations[]).map((note) => (
                <Link key={note.id} href={`/notes/${note.id}`}>
                  <Card className="p-4 active:bg-bg">
                    <div className="flex items-start gap-3">
                      <BookOpen size={19} className="mt-0.5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="text-headline truncate">{note.title}</p>
                        <p className="mt-1 text-caption">
                          {note.articles?.length ?? 0}件の記事
                        </p>
                      </div>
                      <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* タイムライン */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="section-label">タイムライン</p>
            <Link href="/timeline" className="text-[13px] text-accent flex items-center">
              すべて見る <ChevronRight size={15} />
            </Link>
          </div>
          <HomeFeed feed={feed} currentUser={currentUser} />
        </section>
      </div>
    </>
  );
}
