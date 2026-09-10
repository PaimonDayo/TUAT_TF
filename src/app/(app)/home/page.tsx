import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronRight, Folder } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HomeFeed } from "@/components/features/HomeFeed";
import { CompetitionHome } from "@/components/features/CompetitionHome";


import { HomeNotices } from "@/components/features/HomeNotices";
import { InstallPrompt } from "@/components/features/InstallPrompt";
import { ScheduleCard } from "@/components/cards/ScheduleCard";
import { UpcomingScheduleCard } from "@/components/cards/UpcomingScheduleCard";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { jstNow, jstToday } from "@/lib/date";
import { formatKm } from "@/lib/utils";
import { displayedDistance } from "@/lib/record-distance";
import {
  getHomeCompetition,
  getAttendanceSchedules,
  getAttendancesForSchedules,
  getFeed,
  getHomeNotices,
  getRecentSharedNotes,
  getUserRecords,
} from "@/lib/queries";
import { applyMiddleLongMenuSnapshot, middleLongMenuMonths } from "@/lib/middle-long-menu-data";
import { fetchMiddleLongMenuSnapshot } from "@/lib/middle-long-menu-sheet";
import { permissionsOf } from "@/lib/permissions";
import type {
  Attendee,
  NoticeWithReactions,
  NoteWithRelations,
  PracticeRecord,
  ScheduleWithMenus,
} from "@/types";

/**
 * 見出しはプロフィールを待たずに出し、中身の節はそれぞれ独立に流し込む。
 * 1つのSuspenseで全部を包むと、いちばん遅い節（予定＝スプレッドシート取得を含む）が
 * 終わるまで画面が何も出ない。節ごとに分けると、届いたものから順に見えるようになる。
 */
export default function HomePage() {
  const nowJst = jstNow();
  return (
    <>
      <Header title="ホーム" large besideTitle={<time dateTime={jstToday()} className="truncate text-[13px] text-muted">{format(nowJst, "M月d日 (E)", { locale: ja })}</time>} />
      <div className="space-y-5 px-4 pt-1">
        <Suspense fallback={<SectionFallback cards={1} />}><NoticesSection /></Suspense>
        <Suspense fallback={<Skeleton className="h-[92px] w-full rounded-[16px]" />}><CompetitionSection /></Suspense>
        <InstallPrompt />
        <Suspense fallback={null}><WeeklySummarySection nowJst={nowJst} /></Suspense>
        <Suspense fallback={<SectionFallback cards={2} />}><SchedulesSection /></Suspense>
        <Suspense fallback={<SectionFallback cards={2} />}><NotesSection /></Suspense>
        <Suspense fallback={<SectionFallback cards={2} tall />}><FeedSection /></Suspense>
      </div>
    </>
  );
}

/** 節が届くまでの場所取り。見出し1行＋カードの高さだけを確保する。 */
function SectionFallback({ cards, tall = false }: { cards: number; tall?: boolean }) {
  return (
    <section className="space-y-2" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      {Array.from({ length: cards }).map((_, index) => (
        <Skeleton key={index} className={`w-full rounded-[16px] ${tall ? "h-[132px]" : "h-[76px]"}`} />
      ))}
    </section>
  );
}

async function CompetitionSection() {
  const result = await getHomeCompetition();
  if (!result) return null;
  return (
    <CompetitionHome
      competition={result.competition}
      goalCount={result.goalCount}
      initialToday={jstToday()}
    />
  );
}

async function NoticesSection() {
  const profile = await getCurrentProfile();
  const notices = await getHomeNotices(profile.id);
  return <HomeNotices notices={notices as NoticeWithReactions[]} />;
}

/**
 * 走行距離のカードは中長距離の人にだけ出す。出すかどうかはプロフィールを見るまで
 * 決まらないので、場所取りもプロフィールが届いてから（出さない人の画面に、あとで
 * 消える枠を置かないため）。中身の集計はその内側で待たせる。
 */
async function WeeklySummarySection({ nowJst }: { nowJst: Date }) {
  const profile = await getCurrentProfile();
  if (!profile.blocks.includes("middle_long")) return null;
  return (
    <Suspense fallback={<WeeklySummaryFallback />}>
      <WeeklySummary userId={profile.id} nowJst={nowJst} />
    </Suspense>
  );
}

function WeeklySummaryFallback() {
  return (
    <section className="space-y-2" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[86px] rounded-[16px]" />
        <Skeleton className="h-[86px] rounded-[16px]" />
      </div>
    </section>
  );
}

async function WeeklySummary({ userId, nowJst }: { userId: string; nowJst: Date }) {
  const sevenDaysAgo = format(subDays(nowJst, 6), "yyyy-MM-dd");
  const records = (await getUserRecords(userId, sevenDaysAgo)) as PracticeRecord[];
  const weekKm = records.reduce(
    (sum, record) => sum + displayedDistance(record),
    0,
  );
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-caption">直近7日間の走行距離</p>
          <p className="mt-1 text-large-title tabular-nums">
            {formatKm(weekKm)}
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

async function SchedulesSection() {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  const today = jstToday();
  let schedules = (await getAttendanceSchedules(
    profile.blocks,
    perms.manageSystem || profile.blocks.includes("manager") || profile.schedule_view_all_blocks,
    10,
  )) as ScheduleWithMenus[];
  schedules = schedules.map((schedule) => ({ ...schedule, menus: schedule.menus ?? [] }));
  // 複数日開催は最終日まで「本日の予定」に出す（初日を過ぎても消えない）。
  const todaySchedules = schedules.filter(
    (schedule) =>
      schedule.schedule_date <= today &&
      (schedule.end_date ?? schedule.schedule_date) >= today,
  );
  const upcomingSchedules = schedules.filter((schedule) => schedule.schedule_date > today).slice(0, 3);
  const displayed = [...todaySchedules, ...upcomingSchedules];
  if (displayed.length === 0) return null;
  // 出欠はどの予定を出すかだけで決まり、スプレッドシートのメニューには依存しない。
  // 直列にすると外部サイトの応答を待ってから出欠を取りに行くことになるので同時に投げる。
  const wantsSheetMenus =
    profile.blocks.includes("middle_long") || profile.blocks.includes("manager") || profile.menu_view_all_blocks;
  const [attendance, snapshot] = await Promise.all([
    getAttendancesForSchedules(displayed.map((schedule) => schedule.id)),
    wantsSheetMenus ? fetchMiddleLongMenuSnapshot(middleLongMenuMonths(displayed)) : null,
  ]);
  const withMenus = snapshot ? applyMiddleLongMenuSnapshot(displayed, snapshot) : displayed;
  const menusById = new Map(withMenus.map((schedule) => [schedule.id, schedule.menus ?? []]));
  const attendeesBySchedule = new Map<string, Attendee[]>();
  for (const row of attendance) {
    const rows = attendeesBySchedule.get(row.schedule_id) ?? [];
    rows.push({ user_id: row.user_id, attend_date: row.attend_date, status: row.status, is_late: row.is_late, late_note: row.late_note, absence_note: row.absence_note, profile: row.profile });
    attendeesBySchedule.set(row.schedule_id, rows);
  }

  return <div className="space-y-5">
    {todaySchedules.length > 0 && (
      <section className="space-y-2">
        <SectionHeading title="本日の予定" href="/schedule" />
        <div className="space-y-2">
          {todaySchedules.map((schedule) => {
            const attendees = attendeesBySchedule.get(schedule.id) ?? [];
            const mine = attendees.find((attendee) => attendee.user_id === profile.id && attendee.attend_date === schedule.schedule_date);
            return <ScheduleCard key={schedule.id} schedule={{ ...schedule, menus: menusById.get(schedule.id) ?? [] }} viewerBlocks={profile.blocks} userId={profile.id} myProfile={profile} myStatus={mine?.status ?? "none"} myLate={mine?.is_late ?? false} myLateNote={mine?.late_note ?? null} myAbsenceNote={mine?.absence_note ?? null} attendees={attendees} attendanceDefaultBlock={profile.attendance_default_block} canDecidePractice={perms.decidePractice} />;
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
            // コンパクトカードが出すのは初日（まだ来ていない予定なので初日が対象日）。
            const mine = attendees.find(
              (attendee) =>
                attendee.user_id === profile.id &&
                attendee.attend_date === schedule.schedule_date,
            );
            return (
              <UpcomingScheduleCard
                key={schedule.id}
                schedule={{ ...schedule, menus: menusById.get(schedule.id) ?? [] }}
                initialStatus={mine?.status ?? "none"}
                attendees={attendees}
                attendanceDefaultBlock={profile.attendance_default_block}
                userId={profile.id}
                myProfile={profile}
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
          <Link key={note.id} href={`/notes/${note.id}`} prefetch={false}>
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

async function FeedSection() {
  const profile = await getCurrentProfile();
  const [feed, cookieStore] = await Promise.all([getFeed(profile.id, 3), cookies()]);
  const showRecordSource =
    permissionsOf(profile.roles).manageSystem &&
    cookieStore.get("show-record-source")?.value === "1";
  return (
    <section className="space-y-2">
      <SectionHeading title="タイムライン" href="/timeline" />
      <HomeFeed
        feed={feed}
        showRecordSource={showRecordSource}
        currentUser={{
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          systemRecordForm: Boolean(profile.sheet_name),
        }}
      />
    </section>
  );
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="section-label">{title}</p>
      <Link href={href} prefetch={false} className="flex items-center text-[13px] text-accent">
        すべて見る <ChevronRight size={15} />
      </Link>
    </div>
  );
}
