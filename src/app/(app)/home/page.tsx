import Link from "next/link";
import { Suspense } from "react";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { BookOpen, ChevronRight, Clock } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { HomeFeed } from "@/components/features/HomeFeed";
import { HomeNotices } from "@/components/features/HomeNotices";
import { InstallPrompt } from "@/components/features/InstallPrompt";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { jstNow } from "@/lib/date";
import {
  getAttendanceSchedules,
  getAttendancesForSchedules,
  getFeed,
  getHomeNotices,
  getRecentSharedNotes,
  getUserRecords,
} from "@/lib/queries";
import { SCHEDULE_TYPES } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import { venueShort } from "@/lib/venues";
import type {
  AttendanceStatusOrNone,
  NoticeWithReactions,
  NoteWithRelations,
  PracticeRecord,
  PracticeSchedule,
  Profile,
} from "@/types";

export default async function HomePage() {
  const profile = await getCurrentProfile();
  const nowJst = jstNow();

  return (
    <>
      <Header title="ホーム" large />
      <div className="space-y-5 px-4 pt-1">
        <InstallPrompt />

        <p className="text-body text-muted">
          {format(nowJst, "M月d日 (E)", { locale: ja })}
        </p>

        <Suspense fallback={<SectionSkeleton rows={1} />}>
          <NoticesSection userId={profile.id} />
        </Suspense>
        {profile.blocks.includes("middle_long") && (
          <Suspense fallback={<SummarySkeleton />}>
            <WeeklySummary userId={profile.id} nowJst={nowJst} />
          </Suspense>
        )}
        <Suspense fallback={<SectionSkeleton title="予定" rows={2} />}>
          <SchedulesSection profile={profile} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="ノート" rows={1} />}>
          <NotesSection />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="タイムライン" rows={2} />}>
          <FeedSection profile={profile} />
        </Suspense>
      </div>
    </>
  );
}

async function NoticesSection({ userId }: { userId: string }) {
  const notices = await getHomeNotices(userId);
  return <HomeNotices notices={notices as NoticeWithReactions[]} />;
}

async function WeeklySummary({ userId, nowJst }: { userId: string; nowJst: Date }) {
  const sevenDaysAgo = format(subDays(nowJst, 6), "yyyy-MM-dd");
  const records = (await getUserRecords(userId, sevenDaysAgo)) as PracticeRecord[];
  const weekKm = records.reduce(
    (sum, record) =>
      sum + record.dist_low + record.dist_mid + record.dist_high + record.dist_speed,
    0,
  );
  return (
    <section className="space-y-2">
      <p className="section-label">直近7日間のサマリー</p>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-caption">直近7日間の走行距離</p>
          <p className="mt-1 text-large-title tabular-nums">
            {Math.round(weekKm * 10) / 10}
            <span className="ml-1 text-body text-muted">km</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-caption">直近7日間の練習回数</p>
          <p className="mt-1 text-large-title tabular-nums">
            {records.length}
            <span className="ml-1 text-body text-muted">回</span>
          </p>
        </Card>
      </div>
    </section>
  );
}

async function SchedulesSection({ profile }: { profile: Profile }) {
  const perms = permissionsOf(profile.roles);
  const schedules = (await getAttendanceSchedules(
    profile.blocks,
    perms.createSchedule,
    3,
  )) as PracticeSchedule[];
  const attendance = await getAttendancesForSchedules(schedules.map((schedule) => schedule.id));
  const myStatus = new Map<string, AttendanceStatusOrNone>();
  const presentCount = new Map<string, number>();
  const absentCount = new Map<string, number>();
  for (const row of attendance) {
    if (row.user_id === profile.id) myStatus.set(row.schedule_id, row.status);
    if (row.status === "present") {
      presentCount.set(row.schedule_id, (presentCount.get(row.schedule_id) ?? 0) + 1);
    }
    if (row.status === "absent") {
      absentCount.set(row.schedule_id, (absentCount.get(row.schedule_id) ?? 0) + 1);
    }
  }

  return (
    <section className="space-y-2">
      <SectionHeading title="予定" href="/schedule" />
      {schedules.length === 0 ? (
        <EmptyState title="対象の予定はありません" className="min-h-24 py-4" />
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => {
            const meta = SCHEDULE_TYPES[schedule.schedule_type];
            return (
              <Card key={schedule.id} className="flex items-center gap-3 p-3">
                <Link
                  href={`/schedule?open=${schedule.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 active:opacity-60"
                >
                  <div className="flex w-10 shrink-0 flex-col items-center">
                    <span className="text-[10px]" style={{ color: meta.color }}>
                      {format(new Date(`${schedule.schedule_date}T00:00:00`), "EEE", { locale: ja })}
                    </span>
                    <span className="text-xl font-bold leading-tight tabular-nums">
                      {format(new Date(`${schedule.schedule_date}T00:00:00`), "d")}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
                        {meta.label}
                      </Badge>
                      <span className="truncate text-[14px] font-semibold">
                        {schedule.title ?? venueShort(schedule.venue_name) ?? meta.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-x-3 text-[12px] text-muted2">
                      {schedule.meeting_time && (
                        <span className="flex shrink-0 items-center gap-1">
                          <Clock size={12} /> {schedule.meeting_time.slice(0, 5)}
                        </span>
                      )}
                      <span className="shrink-0 text-success">
                        出席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{presentCount.get(schedule.id) ?? 0}</span>
                      </span>
                      <span className="shrink-0 text-danger">
                        欠席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{absentCount.get(schedule.id) ?? 0}</span>
                      </span>
                    </div>
                  </div>
                </Link>
                <AttendanceToggle
                  scheduleId={schedule.id}
                  userId={profile.id}
                  initial={myStatus.get(schedule.id) ?? "none"}
                  refreshOnChange
                />
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

async function NotesSection() {
  const notes = (await getRecentSharedNotes(3)) as NoteWithRelations[];
  if (notes.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeading title="ノート" href="/notes" />
      <div className="space-y-2">
        {notes.map((note) => (
          <Link key={note.id} href={`/notes/${note.id}`}>
            <Card className="p-4 active:bg-bg">
              <div className="flex items-start gap-3">
                <BookOpen size={19} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline">{note.title}</p>
                  <p className="mt-1 text-caption">{note.articles?.length ?? 0}件の記事</p>
                </div>
                <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

async function FeedSection({ profile }: { profile: Profile }) {
  const feed = await getFeed(profile.id, 3);
  return (
    <section className="space-y-2">
      <SectionHeading title="タイムライン" href="/timeline" />
      <HomeFeed
        feed={feed}
        currentUser={{
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        }}
      />
    </section>
  );
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="section-label">{title}</p>
      <Link href={href} className="flex items-center text-[13px] text-accent">
        すべて見る <ChevronRight size={15} />
      </Link>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <section className="space-y-2">
      <Skeleton className="h-3 w-36" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    </section>
  );
}

function SectionSkeleton({ title, rows }: { title?: string; rows: number }) {
  return (
    <section className="space-y-2">
      {title && <p className="section-label">{title}</p>}
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-20 rounded-2xl" />
      ))}
    </section>
  );
}
