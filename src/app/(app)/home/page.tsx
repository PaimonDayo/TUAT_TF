import Link from "next/link";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock, ChevronRight } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { HomeNotices } from "@/components/features/HomeNotices";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { getCurrentProfile } from "@/lib/supabase/auth";
import {
  getFeed,
  getUserRecords,
  getHomeNotices,
  getAttendanceSchedules,
  getAttendancesForSchedules,
} from "@/lib/queries";
import { SCHEDULE_TYPES } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import { venueShort } from "@/lib/venues";
import type {
  PracticeRecord,
  PracticeSchedule,
  Notice,
  AttendanceStatusOrNone,
} from "@/types";

export default async function HomePage() {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  const sevenDaysAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");

  const [weekRecords, feed, notices, attSchedules] = await Promise.all([
    getUserRecords(profile.id, sevenDaysAgo),
    getFeed(profile.id, "all", 3),
    getHomeNotices(profile.id),
    getAttendanceSchedules(profile.blocks, perms.createSchedule, 8),
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
        <p className="text-body text-muted">
          {format(new Date(), "M月d日 (E)", { locale: ja })}
        </p>

        {/* 重要なお知らせ */}
        <HomeNotices notices={notices as Notice[]} userId={profile.id} />

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

        {/* 出欠（これからの予定） */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="section-label">出欠（これからの予定）</p>
            <Link href="/schedule" className="text-[13px] text-accent flex items-center">
              すべて見る <ChevronRight size={15} />
            </Link>
          </div>
          {schedules.length === 0 ? (
            <Card className="p-4">
              <p className="text-caption">対象の予定はありません</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => {
                const meta = SCHEDULE_TYPES[s.schedule_type];
                return (
                  <Card key={s.id} className="p-3 flex items-center gap-3">
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
                        <span className="shrink-0 tabular-nums text-success">参加 {presentCount.get(s.id) ?? 0}</span>
                        {(absentCount.get(s.id) ?? 0) > 0 && (
                          <span className="shrink-0 tabular-nums text-danger">欠席 {absentCount.get(s.id)}</span>
                        )}
                      </div>
                    </div>
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

        {/* 最新の投稿 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="section-label">最新の投稿</p>
            <Link href="/timeline" className="text-[13px] text-accent flex items-center">
              タイムライン <ChevronRight size={15} />
            </Link>
          </div>
          <div className="space-y-3">
            {feed.length === 0 ? (
              <Card className="p-4">
                <p className="text-caption">まだ投稿がありません</p>
              </Card>
            ) : (
              feed.map((item) =>
                item.kind === "record" ? (
                  <RecordCard key={`r-${item.id}`} record={item} currentUser={currentUser} />
                ) : (
                  <TweetCard key={`t-${item.id}`} tweet={item} currentUser={currentUser} />
                ),
              )
            )}
          </div>
        </section>
      </div>
    </>
  );
}
