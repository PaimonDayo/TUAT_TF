"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock, MapPin, ChevronDown, Train, CalendarRange, ExternalLink, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { KeyValue } from "@/components/ui/key-value";
import { SCHEDULE_TYPES, ATTENDANCE_TYPES, BLOCKS, BLOCK_ORDER, viewerCompetitionBlocks } from "@/lib/constants";
import { venueShort } from "@/lib/venues";
import { menuAccess } from "@/lib/menu-permissions";
import { cn } from "@/lib/utils";
import { jstToday } from "@/lib/date";
import { scheduleAttendanceDates } from "@/lib/schedule-days";
import { ScheduleManageActions } from "@/components/post/ScheduleForm";
import { CancelledBanner, WeatherStatusBanner, WeatherStatusControl, type AttendanceChange, type LateAttendanceChange } from "@/components/features/AttendanceToggle";
import { Linkify } from "@/components/common/Linkify";
import { MenuCard } from "./schedule/PracticeMenuCard";
import { ScheduleAttendance } from "./schedule/ScheduleAttendance";
import { seedAttendees, menuCompare } from "./schedule/schedule-card-data";
import type { ScheduleWithMenus, Attendee, AttendanceStatusOrNone, AuthorMini, Block, PracticeMenu } from "@/types";

/** 展開式の練習予定カード */
export function ScheduleCard({
  schedule,
  viewerBlocks = [],
  canEditMenu = false,
  canManageAllMenus = false,
  editableMenuBlocks = [],
  canManage = false,
  canDecidePractice = false,
  userId,
  myProfile,
  myStatus = "none",
  myLate = false,
  myLateNote = null,
  myAbsenceNote = null,
  attendees = [],
  attendanceDefaultBlock = "all",
  defaultOpen = false,
  onOpenChange,
  menuStatus,
}: {
  schedule: ScheduleWithMenus;
  viewerBlocks?: Block[];
  canEditMenu?: boolean;
  canManageAllMenus?: boolean;
  editableMenuBlocks?: Block[];
  canManage?: boolean;
  /** 雨天時など、出欠欄近くに開催の対応状況を表示・編集できる（練習の開催判断権限） */
  canDecidePractice?: boolean;
  userId?: string;
  /** 自分の出欠を即時反映するための最小プロフィール（出欠一覧の表示名等に使う） */
  myProfile?: AuthorMini;
  myStatus?: AttendanceStatusOrNone;
  myLate?: boolean;
  myLateNote?: string | null;
  myAbsenceNote?: string | null;
  attendees?: Attendee[];
  attendanceDefaultBlock?: import("@/types").AttendanceDefaultBlock;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 外部メニューの読み込み・空状態を詳細内に表示する。 */
  menuStatus?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 出欠は日ごとの行（複数日開催なら1日1行）。自分の状態もこの一覧から読む。
  const [attendeesState, setAttendeesState] = useState<Attendee[]>(() =>
    seedAttendees(attendees, {
      userId,
      attendDate: schedule.schedule_date,
      status: myStatus,
      isLate: myLate,
      lateNote: myLateNote,
      absenceNote: myAbsenceNote,
      profile: myProfile,
    }),
  );
  const [weatherNote, setWeatherNote] = useState(schedule.weather_note);
  const [weatherNoteUpdatedAt, setWeatherNoteUpdatedAt] = useState(schedule.weather_note_updated_at);
  const [cancelledAt, setCancelledAt] = useState(schedule.cancelled_at);
  const [cancelReason, setCancelReason] = useState(schedule.cancel_reason);
  const cardRef = useRef<HTMLDivElement>(null);

  // 自分の出欠変更をサーバー往復なしで即座に一覧へ反映する（その日の行だけ）
  function handleAttendanceChanged(attendDate: string, change: AttendanceChange) {
    setAttendeesState((prev) => {
      const others = prev.filter(
        (a) => !(a.user_id === userId && a.attend_date === attendDate),
      );
      if (change.status === "none" || !userId) return others;
      const mineProfile = myProfile ?? prev.find((a) => a.user_id === userId)?.profile;
      if (!mineProfile) return prev;
      const mine: Attendee = {
        user_id: userId,
        attend_date: attendDate,
        status: change.status,
        is_late: change.isLate,
        late_note: change.lateNote,
        absence_note: change.absenceNote,
        profile: mineProfile,
      };
      return [...others, mine];
    });
  }

  // 遅刻操作は出欠状態を変更しない。その日の出席行だけを局所更新する。
  function handleLateChanged(attendDate: string, change: LateAttendanceChange) {
    setAttendeesState((previous) =>
      previous.map((attendee) =>
        attendee.user_id === userId &&
        attendee.attend_date === attendDate &&
        attendee.status === "present"
          ? { ...attendee, is_late: change.isLate, late_note: change.lateNote }
          : attendee,
      ),
    );
  }

  function handleAbsenceNoteChanged(attendDate: string, note: string | null) {
    setAttendeesState((previous) =>
      previous.map((attendee) =>
        attendee.user_id === userId &&
        attendee.attend_date === attendDate &&
        attendee.status === "absent"
          ? { ...attendee, absence_note: note }
          : attendee,
      ),
    );
  }

  useEffect(() => {
    if (defaultOpen) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [defaultOpen]);
  const meta = SCHEDULE_TYPES[schedule.schedule_type];
  const date = new Date(schedule.schedule_date + "T00:00:00");
  const [menusState, setMenusState] = useState<PracticeMenu[]>(schedule.menus ?? []);
  // 一覧のCSV取得やrouter.refreshで届いたメニューを反映する。
  // 同じ入力の再描画ではローカル編集を保持する。
  const [menusSource, setMenusSource] = useState(schedule.menus);
  if (menusSource !== schedule.menus) {
    setMenusSource(schedule.menus);
    setMenusState(schedule.menus ?? []);
  }
  const hasMenus = menusState.length > 0;
  // 並び順は作成日時に依存させない（練習日ごとに入力順が違うと毎回バラつくため）。
  // ブロック全体メニュー→個別メニュー、個別は対象者名の固定順で安定化する。
  const sortedMenus = [...menusState].sort(menuCompare);
  // 所属ブロックごとにメニューをグループ化（自分のブロックを先頭に、全体向けは最後）
  const personalMenus = sortedMenus.filter(
    (menu) => !!userId && (menu.targets?.some((target) => target.user_id === userId) ?? false),
  );
  const personalMenuIds = new Set(personalMenus.map((menu) => menu.id));
  const menusByBlock = new Map<Block, PracticeMenu[]>();
  const generalMenus: PracticeMenu[] = [];
  for (const m of sortedMenus) {
    if (personalMenuIds.has(m.id)) continue;
    if (m.target_block) {
      const list = menusByBlock.get(m.target_block) ?? [];
      list.push(m);
      menusByBlock.set(m.target_block, list);
    } else {
      generalMenus.push(m);
    }
  }
  const effectiveViewerBlocks = viewerCompetitionBlocks(viewerBlocks);
  const blocksByRelevance = [...BLOCK_ORDER].sort(
    (a, b) =>
      Number(effectiveViewerBlocks.includes(b)) - Number(effectiveViewerBlocks.includes(a)),
  );
  const menuGroups: { key: string; label: string; block: Block | null; menus: PracticeMenu[] }[] = [];
  if (personalMenus.length > 0) {
    menuGroups.push({ key: "personal", label: "あなた向け", block: null, menus: personalMenus });
  }
  for (const block of blocksByRelevance) {
    const list = menusByBlock.get(block);
    if (list && list.length > 0) menuGroups.push({ key: block, label: BLOCKS[block].label, block, menus: list });
  }
  if (generalMenus.length > 0) menuGroups.push({ key: "general", label: "全体", block: null, menus: generalMenus });
  const showAttendance = userId && ATTENDANCE_TYPES.includes(schedule.schedule_type);
  const attendanceDays = scheduleAttendanceDates(schedule.schedule_date, schedule.end_date);
  const multiDayAttendance = attendanceDays.length > 1;
  // 中止・対応状況は出欠の有無に関わらず出す（記録会も中止になりうるため）。
  // 編集の導線は当日・翌日か、すでに対応状況が入っている予定だけ。
  const canEditWeather = canDecidePractice && (!!weatherNote || schedule.schedule_date <= jstToday(1));
  const weatherSection = cancelledAt ? "cancelled" : canEditWeather ? "editor" : weatherNote ? "banner" : null;
  function handleCancelChanged(at: string | null, reason: string | null) {
    setCancelledAt(at);
    setCancelReason(reason);
  }
  const hasEntry = schedule.entry_start || schedule.entry_end;
  const hasDetail =
    schedule.venue_access ||
    schedule.venue_fee ||
    schedule.venue_url ||
    schedule.note ||
    hasEntry ||
    hasMenus ||
    !!menuStatus ||
    canEditMenu ||
    canManage;

  return (
    <Card ref={cardRef} className="overflow-hidden scroll-mt-20">
      <button
        type="button"
        data-ui-disclosure
        disabled={!hasDetail}
        onClick={() => {
          if (!hasDetail) return;
          setOpen(!open);
          onOpenChange?.(!open);
        }}
        aria-expanded={hasDetail ? open : undefined}
        className="w-full p-4 flex items-center gap-3 text-left transition-colors duration-100 enabled:active:bg-bg disabled:cursor-default motion-reduce:transition-none lg:gap-2.5 lg:p-3"
      >
        <div className="flex flex-col items-center w-12 shrink-0 lg:w-10">
          <span className="text-[11px]" style={{ color: meta.color }}>
            {format(date, "EEE", { locale: ja })}
          </span>
          <span className="text-2xl font-bold leading-tight tabular-nums lg:text-xl">{format(date, "d")}</span>
          <span className="text-micro">{format(date, "M月", { locale: ja })}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge style={{ backgroundColor: meta.color + "1a", color: meta.color }}>{meta.label}</Badge>
            <span className="text-headline truncate">
              {schedule.title ?? venueShort(schedule.venue_name ?? schedule.location) ?? meta.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted2">
            {schedule.end_date && schedule.end_date !== schedule.schedule_date && (
              <span className="flex items-center gap-1">
                <CalendarRange size={13} />
                {format(date, "M/d", { locale: ja })} 〜{" "}
                {format(new Date(schedule.end_date + "T00:00:00"), "M/d", { locale: ja })}
              </span>
            )}
            {schedule.meeting_time && (
              <span className="flex items-center gap-1">
                <Clock size={13} /> {schedule.meeting_time.slice(0, 5)}
              </span>
            )}
            {/* タイトルがある予定（大会等）は場所も補足表示。練習はタイトル位置が場所なので省略 */}
            {schedule.title && (schedule.venue_name || schedule.location) && (
              <span className="flex items-center gap-1">
                <MapPin size={13} /> {venueShort(schedule.venue_name ?? schedule.location)}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {schedule.target_blocks.length === 0 ? (
              <span className="text-micro rounded-full bg-separator/70 px-2 py-0.5 text-muted2">
                全体
              </span>
            ) : (
              schedule.target_blocks.map((block) => (
                <span
                  key={block}
                  className="text-micro rounded-full px-2 py-0.5"
                  style={{ color: BLOCKS[block].color, backgroundColor: BLOCKS[block].bg }}
                >
                  {BLOCKS[block].short}
                </span>
              ))
            )}
          </div>
        </div>

        {hasDetail && (
          <ChevronDown
            size={18}
            className={cn("text-muted transition-transform shrink-0", open && "rotate-180")}
          />
        )}
      </button>

      {/* 開催の対応状況・中止 */}
      {weatherSection && (
        <div className="-mt-1 px-4 pb-2.5 lg:px-3 lg:pb-2">
          {weatherSection === "cancelled" && (
            <CancelledBanner
              scheduleId={schedule.id}
              reason={cancelReason}
              canDecide={canDecidePractice}
              onChanged={handleCancelChanged}
            />
          )}
          {weatherSection === "editor" && (
            <WeatherStatusControl
              scheduleId={schedule.id}
              initialNote={weatherNote}
              initialUpdatedAt={weatherNoteUpdatedAt}
              onChanged={(note, updatedAt) => { setWeatherNote(note); setWeatherNoteUpdatedAt(updatedAt); }}
              onCancelled={handleCancelChanged}
            />
          )}
          {weatherSection === "banner" && weatherNote && (
            <WeatherStatusBanner note={weatherNote} updatedAt={weatherNoteUpdatedAt} />
          )}
        </div>
      )}

      {/* 出欠行（中止のあいだは出さない） */}
      {showAttendance && !cancelledAt && (
        <ScheduleAttendance
          scheduleId={schedule.id}
          userId={userId!}
          attendanceDays={attendanceDays}
          multiDayAttendance={multiDayAttendance}
          attendeesState={attendeesState}
          attendanceDefaultBlock={attendanceDefaultBlock}
          handleAttendanceChanged={handleAttendanceChanged}
          handleAbsenceNoteChanged={handleAbsenceNoteChanged}
          handleLateChanged={handleLateChanged}
        />
      )}

      {open && hasDetail && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-separator lg:px-3 lg:pb-3 lg:space-y-2.5">
          {hasEntry && (
            <Detail
              icon={<CalendarRange size={14} />}
              label="エントリー期間"
              value={`${fmt(schedule.entry_start)} 〜 ${fmt(schedule.entry_end)}`}
            />
          )}
          {schedule.note && (
            <Detail icon={<Info size={14} />} label="詳細情報" value={schedule.note} />
          )}

          {menuStatus}
          {hasMenus && (
            <div>
              <p className="section-label mb-1.5">練習メニュー</p>
              <div className="space-y-3">
                {menuGroups.map((group) => (
                  <div key={group.key} className="space-y-1.5">
                    <p
                      className="text-[11px] font-semibold"
                      style={{ color: group.block ? BLOCKS[group.block].color : "#8e8e93" }}
                    >
                      {group.label}
                    </p>
                    <div className="space-y-2">
                      {group.menus.map((m) => (
                        <MenuCard
                          key={m.id}
                          menu={m}
                          scheduleId={schedule.id}
                          canManage={
                            m.source === "sheet"
                              ? canEditMenu
                              : menuAccess({ userId, authorId: m.author_id, targetBlock: m.target_block, canCreate: canEditMenu, canManageAll: canManageAllMenus, editableBlocks: editableMenuBlocks }).canEdit
                          }
                          canDelete={menuAccess({ userId, authorId: m.author_id, targetBlock: m.target_block, canCreate: canEditMenu, canManageAll: canManageAllMenus }).canDelete}
                          editableBlocks={editableMenuBlocks}
                          restrictBlock={!canManageAllMenus && m.author_id !== userId}
                          isTargeted={
                            !!userId && (m.targets?.some((t) => t.user_id === userId) ?? false)
                          }
                          isMyBlock={
                            !!m.target_block && effectiveViewerBlocks.includes(m.target_block)
                          }
                          onChanged={(next) => setMenusState((current) => next ? current.map((item) => item.id === next.id ? next : item) : current.filter((item) => item.id !== m.id))}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(schedule.venue_access || schedule.venue_fee) && (
            <Disclosure
              className="border-t-0"
              title={<span className="flex items-center gap-1.5"><Train size={15} /> アクセス・参加費</span>}
            >
              <dl>
                <KeyValue label="アクセス" value={schedule.venue_access} />
                <KeyValue label="参加費" value={schedule.venue_fee} />
              </dl>
            </Disclosure>
          )}
          {schedule.venue_url && (
            <a data-ui-action="text" data-ui-tone="primary" href={schedule.venue_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent pressable">
              <MapPin size={14} /> 地図を開く <ExternalLink size={12} className="opacity-50" />
            </a>
          )}

          {canManage && (
            <div className="flex justify-end">
              <ScheduleManageActions schedule={schedule} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function fmt(d: string | null): string {
  if (!d) return "";
  return format(new Date(d + "T00:00:00"), "M/d", { locale: ja });
}

function Detail({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="section-label mb-0.5 flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-[14px] whitespace-pre-wrap">
        <Linkify text={value} />
      </p>
    </div>
  );
}
