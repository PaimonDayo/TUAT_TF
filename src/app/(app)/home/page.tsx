import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronRight, Folder, Pencil } from "lucide-react";
import { getMyObEntry, getMyObEntryCandidates } from "@/lib/queries/ob-entries";
import { entryEventRows } from "@/lib/ob-entries";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";
import { ObHomeIdentity } from "@/components/features/ObHomeIdentity";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { HomeSkeleton } from "@/components/ui/page-skeletons";
import { HomeFeed } from "@/components/features/HomeFeed";
import { CompetitionHomeSection } from "@/components/features/CompetitionHomeSection";
import { HomeNotices } from "@/components/features/HomeNotices";
import { InstallPrompt } from "@/components/features/InstallPrompt";
import { HomeScheduleCard } from "@/components/cards/HomeScheduleCard";
import { UpcomingScheduleCard } from "@/components/cards/UpcomingScheduleCard";
import { getCurrentProfile, getCurrentUserId } from "@/lib/supabase/auth";
import { jstNow, jstToday } from "@/lib/date";
import { formatKm } from "@/lib/utils";
import {
  getHomeCompetition,
  getAttendanceSchedules,
  getAttendancesForSchedules,
  getCompetitionProgramEntries,
  getFeed,
  getHomeNotices,
  getRecentSharedNotes,
  getUserTrainingSummary,
} from "@/lib/queries";
import { folderContentsLabel } from "@/lib/note-contents";
import { permissionsOf } from "@/lib/permissions";
import { RECORD_SOURCE_COOKIE, showRecordSourceFor } from "@/lib/record-source-display";
import type {
  Attendee,
  NoticeWithReactions,
  NoteWithRelations,
  ScheduleWithMenus,
} from "@/types";

/**
 * 見出しは先に表示し、本文は並列取得して一度に置き換える。
 * 外部シートは予定を開いたときに取得するため、この待ち時間には含めない。
 */
export default function HomePage() {
  const nowJst = jstNow();
  return (
    <>
      <Header title="ホーム" large besideTitle={<time dateTime={jstToday()} className="truncate text-[13px] text-muted">{format(nowJst, "M月d日 (E)", { locale: ja })}</time>} />
      <Suspense fallback={<HomeSkeleton withHeader={false} />}>
        <HomeContent nowJst={nowJst} />
      </Suspense>
    </>
  );
}

async function HomeContent({ nowJst }: { nowJst: Date }) {
  const [notices, competition, obEntry, summary, schedules, notes, feed] = await Promise.all([
    NoticesSection(),
    CompetitionSection(),
    ObEntrySection(),
    WeeklySummarySection({ nowJst }),
    SchedulesSection(),
    NotesSection(),
    FeedSection(),
  ]);
  return (
    <div className="space-y-5 px-4 pt-1">
      {notices}
      {competition}
      {obEntry}
      {summary}
      {schedules}
      {notes}
      {feed}
      <InstallPrompt />
    </div>
  );
}

/** OB戦の自分のエントリー。OB戦は今回システムロール限定なので、その人にだけ出す。 */
async function ObEntrySection() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) return null;
  const entry = await getMyObEntry(profile.id);
  const candidates = entry ? [] : await getMyObEntryCandidates(profile.id);
  const rows = entry ? entryEventRows(entry) : [];
  const footer = (label: string, hint: string, href: string) => (
    <Link href={href} prefetch={false} className="mt-3 flex items-center justify-between gap-3 border-t border-separator pt-3">
      <span className="text-caption">{hint}</span>
      <span className="flex shrink-0 items-center gap-1 text-[14px] font-semibold text-accent"><Pencil size={14} />{label}</span>
    </Link>
  );
  return (
    <section className="space-y-2">
      <p className="section-label">OB戦の自分のエントリー</p>
      <Card className="p-4">
        {entry ? (
          <>
            <Link href={`${OB_PROGRAM_PATH}?edit=mine`} prefetch={false} className="block">
              {rows.length ? (
                <ul className="space-y-1">
                  {rows.map((row) => (
                    <li key={row.event} className="flex items-baseline justify-between gap-3 text-[15px]">
                      <span className="font-medium">{row.event}</span>
                      <span className="truncate text-caption">{row.mark}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[15px] text-muted">競技の出場登録なし</p>}
            </Link>
            {footer("編集する", "種目の追加・取り消し、資格記録を変更できます", `${OB_PROGRAM_PATH}?edit=mine`)}
          </>
        ) : (
          <>
            {candidates.length
              ? <ObHomeIdentity candidates={candidates} profileId={profile.id} />
              : <p className="text-[15px] text-muted">自分に紐付いたエントリーはありません</p>}
            {footer("本人照合", "回答一覧から自分の回答を探して紐付けられます", `${OB_PROGRAM_PATH}?edit=identity`)}
            <Link href={`${OB_PROGRAM_PATH}?edit=mine`} prefetch={false} className="mt-2 block text-right text-caption text-accent">回答していなければ新しくエントリー →</Link>
          </>
        )}
      </Card>
    </section>
  );
}

async function CompetitionSection() {
  const result = await getHomeCompetition();
  if (!result) return <Link href="/competitions" className="block text-right text-caption text-accent">大会一覧・アーカイブ →</Link>;
  const programEntries = result.competition.program_source_url
    ? await getCompetitionProgramEntries(result.competition.id)
    : [];
  return (
      <CompetitionHomeSection
        competition={result.competition}
        entries={programEntries}
        goalCount={result.goalCount}
        initialToday={jstToday()}
      />
  );
}

async function NoticesSection() {
  // お知らせは自分のIDだけで引ける。プロフィールは待たない。
  const notices = await getHomeNotices(await getCurrentUserId());
  return <HomeNotices notices={notices as NoticeWithReactions[]} />;
}

/** 週間集計も本文と一緒に確定させ、後から予定の上へ割り込ませない。 */
async function WeeklySummarySection({ nowJst }: { nowJst: Date }) {
  const profile = await getCurrentProfile();
  if (!profile.blocks.includes("middle_long")) return null;
  const sevenDaysAgo = format(subDays(nowJst, 6), "yyyy-MM-dd");
  const { distance: weekKm, count } = await getUserTrainingSummary(profile.id, sevenDaysAgo);
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
            {count}
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
  // 折りたたんだ予定にはCSVの本文を使わない。展開時だけクライアントで取得する。
  const wantsSheetMenus =
    profile.blocks.includes("middle_long") || profile.blocks.includes("manager") || profile.menu_view_all_blocks;
  const attendance = await getAttendancesForSchedules(displayed.map((schedule) => schedule.id));
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
            return <HomeScheduleCard key={schedule.id} schedule={schedule} loadSheetMenus={wantsSheetMenus} viewerBlocks={profile.blocks} userId={profile.id} myProfile={profile} myStatus={mine?.status ?? "none"} myLate={mine?.is_late ?? false} myLateNote={mine?.late_note ?? null} myAbsenceNote={mine?.absence_note ?? null} attendees={attendees} attendanceDefaultBlock={profile.attendance_default_block} canDecidePractice={perms.decidePractice} />;
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
                schedule={schedule}
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
          <Link key={note.id} href={`/notes/${note.id}`} prefetch={false} className="block">
            <Card className="p-4 active:bg-bg">
              <div className="flex items-start gap-3">
                <Folder size={19} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline">{note.title}</p>
                  <p className="mt-1 text-caption">{folderContentsLabel(note)}</p>
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
  // 投稿は自分のIDだけで引けるので、プロフィールと同時に投げる。
  const userId = await getCurrentUserId();
  const [profile, feed, cookieStore] = await Promise.all([
    getCurrentProfile(),
    getFeed(userId, 3),
    cookies(),
  ]);
  const showRecordSource = showRecordSourceFor(
    permissionsOf(profile.roles).manageSystem,
    cookieStore.get(RECORD_SOURCE_COOKIE)?.value,
  );
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
