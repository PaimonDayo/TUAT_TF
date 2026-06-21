"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import {
  Clock,
  MapPin,
  ChevronDown,
  Train,
  CalendarRange,
  ExternalLink,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionMenu } from "@/components/ui/action-menu";
import { Disclosure } from "@/components/ui/disclosure";
import { KeyValue } from "@/components/ui/key-value";
import { useToast } from "@/components/ui/toast";
import { SCHEDULE_TYPES, ATTENDANCE_TYPES } from "@/lib/constants";
import { BLOCKS } from "@/lib/constants";
import { venueShort } from "@/lib/venues";
import { cn } from "@/lib/utils";
import { MenuEditModal, MenuForm } from "@/components/post/MenuForm";
import { ScheduleManageActions } from "@/components/post/ScheduleForm";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { AttendeesButton } from "@/components/features/AttendeesButton";
import { Linkify } from "@/components/common/Linkify";
import { createClient } from "@/lib/supabase/client";
import type {
  ScheduleWithMenus,
  Attendee,
  AttendanceStatusOrNone,
  Block,
  PracticeMenu,
} from "@/types";

/** 展開式の練習予定カード */
export function ScheduleCard({
  schedule,
  viewerBlocks = [],
  canEditMenu = false,
  canManageAllMenus = false,
  canManage = false,
  userId,
  myStatus = "none",
  attendees = [],
  defaultOpen = false,
}: {
  schedule: ScheduleWithMenus;
  viewerBlocks?: Block[];
  canEditMenu?: boolean;
  canManageAllMenus?: boolean;
  canManage?: boolean;
  userId?: string;
  myStatus?: AttendanceStatusOrNone;
  attendees?: Attendee[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const cardRef = useRef<HTMLDivElement>(null);

  // ホームの「予定」からタップで来たときは、対象カードまでスクロールする
  useEffect(() => {
    if (defaultOpen) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [defaultOpen]);
  const meta = SCHEDULE_TYPES[schedule.schedule_type];
  const date = new Date(schedule.schedule_date + "T00:00:00");
  const hasMenus = schedule.menus && schedule.menus.length > 0;
  // 自分に関係するメニュー（自分が対象者 or 自分のブロック）を上に優先表示
  const isRelevantMenu = (m: PracticeMenu) =>
    (!!userId && (m.targets?.some((t) => t.user_id === userId) ?? false)) ||
    (!!m.target_block && viewerBlocks.includes(m.target_block));
  const sortedMenus = [...(schedule.menus ?? [])].sort(
    (a, b) => Number(isRelevantMenu(b)) - Number(isRelevantMenu(a)),
  );
  const showAttendance = userId && ATTENDANCE_TYPES.includes(schedule.schedule_type);
  const hasEntry = schedule.entry_start || schedule.entry_end;
  const hasDetail =
    schedule.venue_access ||
    schedule.venue_fee ||
    schedule.venue_url ||
    schedule.note ||
    hasEntry ||
    hasMenus ||
    canEditMenu ||
    canManage;

  return (
    <Card ref={cardRef} className="overflow-hidden scroll-mt-20">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="w-full p-4 flex items-center gap-3 text-left active:bg-bg"
      >
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="text-[11px]" style={{ color: meta.color }}>
            {format(date, "EEE", { locale: ja })}
          </span>
          <span className="text-2xl font-bold leading-tight tabular-nums">{format(date, "d")}</span>
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

      {/* 出欠行 */}
      {showAttendance && (
        <div className="px-4 pb-3 -mt-1 flex items-center gap-2">
          <AttendanceToggle
            scheduleId={schedule.id}
            userId={userId!}
            initial={myStatus}
            refreshOnChange
          />
          <AttendeesButton attendees={attendees} />
        </div>
      )}

      {open && hasDetail && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-separator">
          {hasEntry && (
            <Detail
              icon={<CalendarRange size={14} />}
              label="エントリー期間"
              value={`${fmt(schedule.entry_start)} 〜 ${fmt(schedule.entry_end)}`}
            />
          )}
          {(schedule.venue_access || schedule.venue_fee) && (
            <Disclosure
              title={
                <span className="flex items-center gap-1.5">
                  <Train size={15} /> アクセス・参加費
                </span>
              }
            >
              <dl>
                <KeyValue label="アクセス" value={schedule.venue_access} />
                <KeyValue label="参加費" value={schedule.venue_fee} />
              </dl>
            </Disclosure>
          )}
          {schedule.note && (
            <Detail icon={<Info size={14} />} label="詳細情報" value={schedule.note} />
          )}
          {schedule.venue_url && (
            <a
              href={schedule.venue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent font-medium active:opacity-50"
            >
              <MapPin size={14} /> 地図を開く <ExternalLink size={12} className="opacity-50" />
            </a>
          )}

          {(hasMenus || canEditMenu) && (
            <div>
              <p className="section-label mb-1.5">練習メニュー</p>
              <div className="space-y-2">
                {sortedMenus.map((m) => (
                  <MenuCard
                    key={m.id}
                    menu={m}
                    scheduleId={schedule.id}
                    canManage={
                      canManageAllMenus || (!!userId && m.author?.id === userId)
                    }
                    onChanged={() => router.refresh()}
                  />
                ))}
              </div>
              {canEditMenu && <MenuForm scheduleId={schedule.id} />}
            </div>
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

function MenuCard({
  menu,
  scheduleId,
  canManage,
  onChanged,
}: {
  menu: PracticeMenu;
  scheduleId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const targetNames =
    menu.targets?.map((target) => target.profile?.display_name).filter(Boolean) ?? [];

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("practice_menus").delete().eq("id", menu.id);
    if (error) {
      showToast("練習メニューを削除できませんでした");
      return false;
    }
    onChanged();
    return true;
  }

  return (
    <div className="rounded-xl bg-bg p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {menu.status === "draft" && (
              <span className="rounded border border-warning px-1.5 py-0.5 text-[10px] font-bold text-warning">
                下書き
              </span>
            )}
            {menu.target_block && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  color: BLOCKS[menu.target_block].color,
                  backgroundColor: BLOCKS[menu.target_block].bg,
                }}
              >
                {BLOCKS[menu.target_block].label}
              </span>
            )}
            {targetNames.length > 0 && (
              <span className="text-[11px] text-muted2">
                対象: {targetNames.join("、")}
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <ActionMenu
            onEdit={() => setEditing(true)}
            onDelete={remove}
            deleteTitle="練習メニューを削除しますか？"
            deleteDescription="削除したメニューは元に戻せません。"
            triggerLabel="練習メニューの操作"
          />
        )}
      </div>
      <p className="mt-1 text-[14px] whitespace-pre-wrap">
        <Linkify text={menu.content} />
      </p>
      <MenuEditModal
        menu={menu}
        scheduleId={scheduleId}
        open={editing}
        onOpenChange={setEditing}
      />
    </div>
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
