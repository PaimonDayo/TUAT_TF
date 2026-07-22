import Link from "next/link";
import { Suspense } from "react";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronRight, Folder } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { HomeSkeleton } from "@/components/ui/page-skeletons";
import { HomeFeed } from "@/components/features/HomeFeed";
import { HomeNotices } from "@/components/features/HomeNotices";
import { InstallPrompt } from "@/components/features/InstallPrompt";
import { ScheduleCard } from "@/components/cards/ScheduleCard";
import { UpcomingScheduleCard } from "@/components/cards/UpcomingScheduleCard";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { jstNow, jstToday } from "@/lib/date";
import {
  getAttendanceSchedules,
  getAttendancesForSchedules,
  getFeed,
  getHomeNotices,
  getRecentSharedNotes,
  getUserRecords,
} from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type {
  Attendee,
  NoticeWithReactions,
  NoteWithRelations,
  PracticeRecord,
  ScheduleWithMenus,
  Profile,
} from "@/types";

export default function HomePage() {
  return <Suspense fallback={<HomeSkeleton />}><HomeContent /></Suspense>;
}

export async function HomeContent() {
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

        <NoticesSection userId={profile.id} />
        {profile.blocks.includes("middle_long") && (
          <WeeklySummary userId={profile.id} nowJst={nowJst} />
        )}
        <SchedulesSection profile={profile} />
        <NotesSection />
        <FeedSection profile={profile} />
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
  const today = jstToday();
  const schedules = (await getAttendanceSchedules(
    profile.blocks,
    perms.createSchedule,
    10,
  )) as ScheduleWithMenus[];
  const todaySchedules = schedules.filter((schedule) => schedule.schedule_date === today);
  const upcomingSchedules = schedules.filter((schedule) => schedule.schedule_date > today).slice(0, 3);
  const displayed = [...todaySchedules, ...upcomingSchedules];
  if (displayed.length === 0) return null;
  const attendance = await getAttendancesForSchedules(displayed.map((schedule) => schedule.id));
  const attendeesBySchedule = new Map<string, Attendee[]>();
  for (const row of attendance) {
    const rows = attendeesBySchedule.get(row.schedule_id) ?? [];
    rows.push({ user_id: row.user_id, status: row.status, is_late: row.is_late, late_note: row.late_note, profile: row.profile });
    attendeesBySchedule.set(row.schedule_id, rows);
  }

  return <div className="space-y-5">
    {todaySchedules.length > 0 && (
      <section className="space-y-2">
        <SectionHeading title="本日の予定" href="/schedule" />
        <div className="space-y-2">
          {todaySchedules.map((schedule) => {
            const attendees = attendeesBySchedule.get(schedule.id) ?? [];
            const mine = attendees.find((attendee) => attendee.user_id === profile.id);
            return <ScheduleCard key={schedule.id} schedule={{ ...schedule, menus: schedule.menus ?? [] }} viewerBlocks={profile.blocks} userId={profile.id} myProfile={profile} myStatus={mine?.status ?? "none"} myLate={mine?.is_late ?? false} myLateNote={mine?.late_note ?? null} attendees={attendees} showAllAttendanceBlocks={profile.attendance_view_all_blocks ?? false} />;
          })}
        </div>
      </section>
    )}
    {upcomingSchedules.length > 0 && (
      <section className="space-y-2">
        <SectionHeading title="今後の予定" href="/schedule" />
        <div className="space-y-2">
          {upcomingSchedules.map((schedule) => {
            const attendees = attendeesBySchedule.get(schedule.id) ?? [];
            const mine = attendees.find((attendee) => attendee.user_id === profile.id);
            return (
              <UpcomingScheduleCard
                key={schedule.id}
                schedule={{ ...schedule, menus: schedule.menus ?? [] }}
                initialStatus={mine?.status ?? "none"}
                initialPresent={attendees.filter((attendee) => attendee.status === "present").length}
                initialAbsent={attendees.filter((attendee) => attendee.status === "absent").length}
                userId={profile.id}
              />
            );
          })}
        </div>
      </section>
    )}
  </div>;
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
                <Folder size={19} className="mt-0.5 shrink-0 text-accent" />
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
